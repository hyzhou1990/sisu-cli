import fs from 'fs'
import os from 'os'
import path from 'path'
import { runPager, PagerIo, chromeShortQuota } from './app'
import { readSession } from '../store'
import type { TurnTransport } from '../transport'

const previousHome = process.env.SISU_HOME
let testHome = ''

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-pager-'))
  process.env.SISU_HOME = testHome
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.SISU_HOME
  else process.env.SISU_HOME = previousHome
  fs.rmSync(testHome, { recursive: true, force: true })
})

function stubTransport(overrides: Partial<TurnTransport> = {}): TurnTransport {
  return {
    async *send() { return { conversationId: '' } },
    async listConversations() { return [] },
    async getConversation(id: string) { return { id, title: '', messages: [] } },
    ...overrides,
  }
}

function fakeIo(writes: string[]): PagerIo & { feed(chunk: string): void; leftRaw: boolean } {
  let handler: (chunk: string) => void = () => undefined
  return {
    write: (text) => { writes.push(text) },
    onData: (h) => { handler = h; return () => undefined },
    enterRaw: () => undefined,
    leaveRaw() { this.leftRaw = true },
    columns: 40,
    rows: 10,
    leftRaw: false,
    feed(chunk) { handler(chunk) },
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await tick()
}

function readyPager(
  io: PagerIo,
  transport: TurnTransport,
  options: {
    columns?: number
    rows?: number
    email?: string
    quota?: () => Promise<string> | string
    login?: (notify: (line: string) => void) => Promise<string>
    intro?: boolean
    introFrames?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
) {
  let signal!: () => void
  const started = new Promise<void>((resolve) => { signal = resolve })
  const done = runPager(io, transport, { ...options, ready: signal })
  return { done, started }
}

it('enters alternate screen, streams a turn, and restores the terminal', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() {
      yield { type: 'text' as const, text: 'pong' }
      return { conversationId: 'c1' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  io.feed('hi\r')
  await flush()
  io.feed('/quit\r')
  await done
  expect(writes.some((item) => item.includes('\x1b[?1049h'))).toBe(true)
  expect(writes.some((item) => item.includes('pong'))).toBe(true)
  expect(writes.some((item) => item.includes('\x1b[?1049l'))).toBe(true)
  expect(io.leftRaw).toBe(true)
})

it('restores the terminal when send throws', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() {
      throw new Error('boom')
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  io.feed('hi\r')
  await flush()
  io.feed('/quit\r')
  await expect(done).resolves.toBe(0)
  expect(writes.some((item) => item.includes('boom'))).toBe(true)
  expect(writes.some((item) => item.includes('\x1b[?1049l'))).toBe(true)
  expect(io.leftRaw).toBe(true)
})

it('quits on escape or ctrl-c when the draft is empty', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport()
  const first = readyPager(io, transport, { columns: 40, rows: 10 })
  await first.started
  io.feed('\x1b')
  await expect(first.done).resolves.toBe(0)

  const writes2: string[] = []
  const io2 = fakeIo(writes2)
  const second = readyPager(io2, transport, { columns: 40, rows: 10 })
  await second.started
  io2.feed('\x03')
  await expect(second.done).resolves.toBe(0)
  expect(io.leftRaw).toBe(true)
  expect(io2.leftRaw).toBe(true)
})

it('paints quota in chrome after the pager starts and after a turn', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  let calls = 0
  const transport = stubTransport({
    async *send() { return { conversationId: 'c-q' } },
  })
  const { done, started } = readyPager(io, transport, {
    columns: 80,
    rows: 10,
    email: 'ada@b.c',
    quota: async () => {
      calls += 1
      return calls === 1 ? 'quota 12 pts' : 'quota 11 pts'
    },
  })
  await started
  expect(writes.join('')).toContain('quota 12 pts')
  expect(writes.join('')).not.toContain('billed to this account')
  io.feed('hi\r')
  await flush()
  expect(writes.at(-1)).toContain('quota 11 pts')
  expect(writes.at(-1)).toContain('c-q')
  io.feed('/quit\r')
  await done
})

it('keeps the pager up when quota fetch fails', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const { done, started } = readyPager(io, stubTransport(), {
    columns: 80,
    rows: 10,
    email: 'ada@b.c',
    quota: async () => { throw new Error('balance down') },
  })
  await started
  expect(writes.join('')).toContain('ada@b.c')
  io.feed('/quit\r')
  await done
})

it('paints first-frame chrome and updates it when the conversation id changes', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() { return { conversationId: 'c-from-send' } },
  })
  const { done, started } = readyPager(io, transport, {
    columns: 80,
    rows: 10,
    email: 'ada@b.c',
  })
  await started
  const first = writes.join('')
  expect(first).toContain('ada@b.c')
  expect(first).not.toContain('billed to this account')
  expect(first).not.toContain('client=tui')
  io.feed('/open conv-99\r')
  await flush()
  expect(writes.at(-1)).toContain('conv-99')
  expect(writes.at(-1)).toContain('ada@b.c')
  io.feed('/new\r')
  await flush()
  expect(writes.at(-1)).not.toContain('conv-99')
  io.feed('/quit\r')
  await done
})

it('resume lists cloud conversations and open selects one', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const sent: Array<{ conversationId?: string; newConversation?: boolean }> = []
  const transport = stubTransport({
    async *send(_prompt, options) {
      sent.push(options ?? {})
      return { conversationId: 'ignored' }
    },
    async listConversations() {
      return [{ id: 'conv-99', title: 'prior turn', client: 'tui' }]
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12 })
  await started
  io.feed('/resume\r')
  await flush()
  expect(writes.join('')).toMatch(/conv-99/)
  io.feed('\r')
  await flush()
  expect(writes.at(-1)).toContain('conv-99')
  io.feed('continue\r')
  await flush()
  expect(sent.at(-1)?.conversationId).toBe('conv-99')
  expect(sent.at(-1)?.newConversation).toBe(false)
  io.feed('/quit\r')
  await done
})

it('resume Enter opens the newest listed conversation', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const sent: Array<{ conversationId?: string; newConversation?: boolean }> = []
  const transport = stubTransport({
    async *send(_prompt, options) {
      sent.push(options ?? {})
      return { conversationId: 'ignored' }
    },
    async listConversations() {
      // GET /conversations is last_activity_at DESC: newest first.
      return [
        { id: 'conv-new', title: 'newest turn', client: 'tui' },
        { id: 'conv-old', title: 'oldest turn', client: 'web' },
      ]
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 64, rows: 14 })
  await started
  io.feed('/resume\r')
  await flush()
  const listed = writes.join('')
  expect(listed).toMatch(/conv-new/)
  expect(listed).toMatch(/conv-old/)
  io.feed('\r')
  await flush()
  expect(writes.at(-1)).toContain('conv-new')
  expect(writes.at(-1)).not.toContain('conv-old')
  io.feed('continue\r')
  await flush()
  expect(sent.at(-1)?.conversationId).toBe('conv-new')
  io.feed('/open conv-old\r')
  await flush()
  expect(writes.at(-1)).toContain('conv-old')
  io.feed('/quit\r')
  await done
})

it('lists conversations on /resume and opens an id', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() {
      return { conversationId: 'ignored' }
    },
    async listConversations() {
      return [{ id: 'conv-99', title: 'prior turn', client: 'tui' }]
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12 })
  await started
  io.feed('/resume\r')
  await flush()
  expect(writes.join('')).toMatch(/conv-99/)
  io.feed('/open conv-99\r')
  await flush()
  expect(writes.at(-1)).toContain('conv-99')
  io.feed('/quit\r')
  await done
})

it('opens a conversation by painting its transcript and clearing the prior thread', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() { return { conversationId: 'ignored' } },
    async getConversation(id) {
      return {
        id,
        title: 'prior',
        messages: [
          { id: 'm1', role: 'user', content: 'old-user-line' },
          { id: 'm2', role: 'assistant', content: 'old-assistant-line' },
        ],
      }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12 })
  await started
  io.feed('stale\r')
  await flush()
  expect(writes.at(-1)).toContain('stale')
  io.feed('/open conv-99\r')
  await flush()
  const frame = writes.at(-1) || ''
  expect(frame).toContain('old-user-line')
  expect(frame).toContain('old-assistant-line')
  expect(frame).toContain('conv-99')
  expect(frame).not.toContain('stale')
  io.feed('/quit\r')
  await done
})

it('binds the id and shows an error when transcript load fails', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async getConversation() { throw new Error('not found') },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12 })
  await started
  io.feed('/open conv-missing\r')
  await flush()
  expect(writes.at(-1)).toContain('conv-missing')
  expect(writes.at(-1)).toContain('not found')
  io.feed('/quit\r')
  await done
})

it('keeps streamed answer after tool cards and visible as the turn tail', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() {
      yield { type: 'tool' as const, text: 'read_file · call · path=a.ts' }
      yield { type: 'text' as const, text: 'final-answer' }
      return { conversationId: 'c1' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 64, rows: 12 })
  await started
  io.feed('run\r')
  await flush()
  const frame = writes.at(-1) || ''
  const toolAt = frame.indexOf('read_file')
  const answerAt = frame.indexOf('final-answer')
  expect(toolAt).toBeGreaterThan(-1)
  expect(answerAt).toBeGreaterThan(toolAt)
  io.feed('/quit\r')
  await done
})

it('restores the terminal if SIGTERM arrives during startup quota fetch', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  let release!: () => void
  const held = new Promise<string>((resolve) => { release = () => resolve('quota 1 pts') })
  const done = runPager(io, stubTransport(), {
    columns: 40,
    rows: 10,
    quota: () => held,
  })
  await flush()
  process.emit('SIGTERM')
  await expect(done).resolves.toBe(0)
  expect(writes.some((item) => item.includes('\x1b[?1049l'))).toBe(true)
  expect(io.leftRaw).toBe(true)
  release()
})

it('paints a tool entry when the transport yields a tool event', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async *send() {
      yield { type: 'tool' as const, text: 'read_file · tool_call · {"path":"a.ts"}' }
      return { conversationId: 'c1' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 64, rows: 12 })
  await started
  io.feed('run\r')
  await flush()
  expect(writes.at(-1)).toContain('read_file')
  io.feed('/quit\r')
  await done
})

it('keeps /new intent until a conversation id is bound', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const sent: Array<{ conversationId?: string; newConversation?: boolean }> = []
  let newAttempts = 0
  const transport = stubTransport({
    async *send(_prompt, options) {
      sent.push(options ?? {})
      if (options?.newConversation) {
        newAttempts += 1
        if (newAttempts === 1) throw new Error('create failed')
        return { conversationId: 'c-new' }
      }
      return { conversationId: 'c-old' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  io.feed('old\r')
  await flush()
  io.feed('/new\r')
  await flush()
  io.feed('next\r')
  await flush()
  expect(sent[1]?.newConversation).toBe(true)
  expect(sent[1]?.conversationId).toBeUndefined()
  expect(writes.join('')).toContain('create failed')
  io.feed('retry\r')
  await flush()
  expect(sent[2]?.newConversation).toBe(true)
  expect(sent[2]?.conversationId).toBeUndefined()
  io.feed('/quit\r')
  await done
})

it('binds chrome as soon as transport yields the conversation id', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  let release!: (event: { type: 'text'; text: string }) => void
  const held = new Promise<{ type: 'text'; text: string }>((resolve) => { release = resolve })
  const transport = stubTransport({
    async *send() {
      yield { type: 'bound' as const, text: 'c-early' }
      yield await held
      return { conversationId: 'c-early' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 10, email: 'ada@b.c' })
  await started
  io.feed('/new\r')
  await flush()
  io.feed('hello\r')
  await flush()
  expect(writes.at(-1)).toContain('c-early')
  release({ type: 'text', text: 'later' })
  await flush()
  io.feed('/quit\r')
  await done
})

it('clears scrollback on /new and flags the next send', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const sent: Array<{ conversationId?: string; newConversation?: boolean }> = []
  const transport = stubTransport({
    async *send(_prompt, options) {
      sent.push(options ?? {})
      yield { type: 'text' as const, text: 'fresh' }
      return { conversationId: 'c-new' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  io.feed('old\r')
  await flush()
  expect(writes.at(-1)).toContain('old')
  io.feed('/new\r')
  await flush()
  expect(writes.at(-1)).not.toContain('old')
  io.feed('next\r')
  await flush()
  expect(sent.at(-1)?.newConversation).toBe(true)
  io.feed('/status\r')
  await flush()
  expect(writes.join('')).toContain('not wired')
  io.feed('/quit\r')
  await done
})

it('restores the terminal on SIGTERM', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport()
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  process.emit('SIGTERM')
  await expect(done).resolves.toBe(0)
  expect(writes.some((item) => item.includes('\x1b[?1049l'))).toBe(true)
  expect(io.leftRaw).toBe(true)
})

it('does not paint a send frame after SIGTERM has left the alt screen', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  let release!: (event: { type: 'text'; text: string }) => void
  const held = new Promise<{ type: 'text'; text: string }>((resolve) => { release = resolve })
  const transport = stubTransport({
    async *send() {
      yield await held
      return { conversationId: 'c1' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  io.feed('hi\r')
  await flush()
  process.emit('SIGTERM')
  await expect(done).resolves.toBe(0)
  const leaveAt = writes.findIndex((item) => item.includes('\x1b[?1049l'))
  expect(leaveAt).toBeGreaterThan(-1)
  release({ type: 'text', text: 'late-frame' })
  await flush()
  expect(writes.slice(leaveAt + 1).join('')).not.toContain('late-frame')
  expect(io.leftRaw).toBe(true)
})

it('restores if the first paint throws', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  let writesSeen = 0
  io.write = (text) => {
    writes.push(text)
    writesSeen += 1
    if (writesSeen === 2) throw new Error('paint fail')
  }
  const transport = stubTransport()
  await expect(runPager(io, transport, { columns: 40, rows: 10 })).rejects.toThrow('paint fail')
  expect(writes.some((item) => item.includes('\x1b[?1049l'))).toBe(true)
  expect(io.leftRaw).toBe(true)
})

it('keeps an incomplete CSI sequence across stdin chunks', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport()
  const { done, started } = readyPager(io, transport, { columns: 40, rows: 10 })
  await started
  io.feed('\x1b[')
  await flush()
  expect(io.leftRaw).toBe(false)
  io.feed('A')
  await flush()
  io.feed('/quit\r')
  await expect(done).resolves.toBe(0)
})

it('persists last_conversation_id on /open success and GET-failure bind', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async getConversation(id) {
      if (id === 'conv-missing') throw new Error('not found')
      return { id, title: 'prior', messages: [] }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12 })
  await started
  io.feed('/open conv-99\r')
  await flush()
  expect(readSession().last_conversation_id).toBe('conv-99')
  io.feed('/open conv-missing\r')
  await flush()
  expect(readSession().last_conversation_id).toBe('conv-missing')
  expect(writes.at(-1)).toContain('not found')
  io.feed('/quit\r')
  await done
})

it('persists last_conversation_id when resume Enter binds a row', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const transport = stubTransport({
    async listConversations() {
      return [{ id: 'conv-new', title: 'newest turn', client: 'tui' }]
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12 })
  await started
  io.feed('/resume\r')
  await flush()
  io.feed('\r')
  await flush()
  expect(readSession().last_conversation_id).toBe('conv-new')
  io.feed('/quit\r')
  await done
})

it('chromeShortQuota keeps unlimited, first pts segment, or unavailable', () => {
  expect(chromeShortQuota('quota unlimited')).toBe('quota unlimited')
  expect(chromeShortQuota('quota 12 pts')).toBe('quota 12 pts')
  expect(chromeShortQuota('quota 12000 pts · Pro 8000 · wallet 3000 · bonus 1000 · allowance 200/8000'))
    .toBe('quota 12000 pts')
  expect(chromeShortQuota('')).toBe('quota unavailable')
  expect(chromeShortQuota('something else')).toBe('quota unavailable')
})

it('keeps email and short quota on an 80-col frame when quota is a long formatQuota line', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const longQuota = 'quota 12000 pts · Pro 8000 · wallet 3000 · bonus 1000 · allowance 200/8000'
  const { done, started } = readyPager(io, stubTransport(), {
    columns: 80,
    rows: 10,
    email: 'ada@b.c',
    quota: () => longQuota,
  })
  await started
  const frame = writes.at(-1) || ''
  const status = frame.split('\n').find((line) => line.includes('ada@b.c')) || ''
  expect(status).toContain('quota 12000 pts')
  expect(status).not.toContain('wallet 3000')
  expect(status).not.toContain('allowance 200/8000')
  io.feed('/quit\r')
  await done
})

it('plays the Möbius intro inside the pager so the prompt does not jump in', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const { done, started } = readyPager(io, stubTransport(), {
    columns: 72,
    rows: 24,
    intro: true,
    introFrames: 5,
    sleep: async () => undefined,
  })
  await started
  const homes = writes.filter((item) => item.includes('\x1b[H')).length
  expect(homes).toBeGreaterThanOrEqual(5)
  expect(writes[0]).toContain('\x1b[?1049h')
  expect(writes.at(-1)).toContain('›')
  expect(writes.at(-1)).toMatch(/思溯|思有所溯/)
  io.feed('/quit\r')
  await done
})

it('enters logged out, blocks turns, and completes /login in the pager', async () => {
  const writes: string[] = []
  const io = fakeIo(writes)
  const login = jest.fn(async (notify: (line: string) => void) => {
    notify('Open https://www.sisu.chat/api/auth/cli/verify?user_code=AA-11')
    return 'ada@b.c'
  })
  const sent: string[] = []
  const transport = stubTransport({
    async *send(prompt) {
      sent.push(prompt)
      yield { type: 'text' as const, text: 'should-not-send' }
      return { conversationId: 'c1' }
    },
  })
  const { done, started } = readyPager(io, transport, { columns: 48, rows: 12, login })
  await started
  expect(writes.at(-1)).toContain('not signed in')
  expect(writes.at(-1)).toMatch(/[@%#*+=.•-]|思溯/)
  expect(writes.at(-1)).toContain('/login')
  io.feed('hello\r')
  await flush()
  expect(sent).toEqual([])
  expect(writes.at(-1)).toMatch(/Type \/login/)
  io.feed('/login\r')
  await flush()
  expect(login).toHaveBeenCalled()
  expect(writes.at(-1)).toContain('logged in as ada@b.c')
  expect(writes.at(-1)).toContain('ada@b.c')
  io.feed('/quit\r')
  await done
})
