import { readSession, writeSession } from '../store'
import type { TurnTransport } from '../transport'
import { decodeKeys } from './input'
import {
  applyKey,
  appendText,
  createPagerState,
  filterSlash,
  insertToolBeforeLiveAssistant,
  SLASH_COMMANDS,
  startAssistant,
  type EntryKind,
  type PagerEntry,
  type PagerKey,
  type PagerState,
} from './model'
import { entriesFromMessages } from './history'
import { SISU_STILL_PHASE } from '../logo'
import { renderPager } from './render'
import type { ThemeName } from './theme'

const ALT_ENTER = '\x1b[?1049h\x1b[?25l'
const ALT_LEAVE = '\x1b[?1049l\x1b[?25h'

export interface PagerIo {
  write(text: string): void
  onData(handler: (chunk: string) => void): () => void
  enterRaw(): void
  leaveRaw(): void
  columns: number
  rows: number
}

export interface RunPagerOptions {
  columns?: number
  rows?: number
  ready?: () => void
  theme?: ThemeName
  /** Logged-in email for first-frame chrome (email · quota · id · client=tui). */
  email?: string
  quota?: () => Promise<string> | string
  status?: () => Promise<string> | string
  ls?: () => Promise<string> | string
  training?: (on: boolean) => Promise<string> | string
  login?: (notify: (line: string) => void) => Promise<string>
  /** Play the Möbius twist in the pager grid before taking input. */
  intro?: boolean
  sleep?: (ms: number) => Promise<void>
  introFrames?: number
}

export function formatChromeStatus(
  email: string | undefined,
  quota: string,
  conversationId: string,
): string {
  const who = (email || '').trim()
  if (!who) {
    const conv = (conversationId || '').trim()
    return conv && conv !== 'new' ? `sisu · not signed in · ${conv}` : 'sisu · not signed in'
  }
  const parts = [who]
  const quotaText = (quota || '').trim()
  if (quotaText && quotaText !== 'quota unavailable') parts.push(quotaText)
  const conv = (conversationId || '').trim()
  if (conv && conv !== 'new') parts.push(conv)
  return parts.join(' · ')
}

/** Short chrome fragment: `quota unlimited`, first `quota N pts`, or `quota unavailable`. */
export function chromeShortQuota(full: string): string {
  const text = (full || '').trim()
  if (!text) return 'quota unavailable'
  const first = text.split(' · ')[0].trim()
  if (first === 'quota unlimited') return 'quota unlimited'
  if (/^quota\s+\d+\s+pts$/.test(first)) return first
  if (first === 'quota unavailable' || first.startsWith('quota unavailable')) return 'quota unavailable'
  return 'quota unavailable'
}

let nextAppEntryId = 1

function pushEntry(state: PagerState, kind: EntryKind, text: string): PagerState {
  const folded = kind === 'tool' && text.split('\n').length > 8
  const entry: PagerEntry = { id: `p${nextAppEntryId}`, kind, text, folded }
  nextAppEntryId += 1
  const entries = [...state.entries, entry]
  return { ...state, entries, selected: entries.length - 1 }
}

function clearDraft(state: PagerState): PagerState {
  return { ...state, draft: '', slashOpen: false, slashIndex: 0 }
}

function submittedText(state: PagerState): string {
  const raw = state.draft.trim()
  if (state.slashOpen && !/\s/.test(raw)) {
    const items = filterSlash(state.draft)
    const picked = items[state.slashIndex]
    if (picked) return picked.name
  }
  return raw
}

function commandHead(text: string): string {
  const token = text.split(/\s+/, 1)[0] || text
  if (token === '/exit') return '/quit'
  if (token === '/clear') return '/new'
  if (token === '/history') return '/resume'
  return token
}

async function resolveText(value: Promise<string> | string): Promise<string> {
  return value
}

export async function runPager(
  io: PagerIo,
  transport: TurnTransport,
  options: RunPagerOptions = {},
): Promise<number> {
  const cols = options.columns ?? io.columns
  const rows = options.rows ?? io.rows
  let theme: ThemeName = options.theme ?? 'dark'
  let quotaLine = 'quota unavailable'
  let chromeEmail = (options.email || '').trim()
  const withChrome = (next: PagerState): PagerState => ({
    ...next,
    statusLine: formatChromeStatus(chromeEmail, quotaLine, next.conversationId),
  })
  const refreshQuota = async () => {
    if (!options.quota) return
    try {
      quotaLine = chromeShortQuota((await resolveText(options.quota())).trim() || 'quota unavailable')
    } catch {
      quotaLine = 'quota unavailable'
    }
  }
  let state = withChrome(createPagerState())
  let rest = ''
  let newConversation = false
  let pickMode = false
  const pickableIds = new Map<string, string>()
  let running = true
  let processing = false
  const pending: PagerKey[] = []
  let unsubscribe: () => void = () => undefined

  const paint = (phase = SISU_STILL_PHASE) => {
    if (!running) return
    io.write(`\x1b[H${renderPager(state, cols, rows, theme, { phase })}\x1b[J`)
  }

  const playIntro = async () => {
    const frames = Math.max(2, options.introFrames ?? 32)
    const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    for (let i = 0; i < frames; i += 1) {
      if (!running) return
      const u = i / (frames - 1)
      paint(SISU_STILL_PHASE + u * Math.PI * 2)
      await sleep(38)
    }
  }

  let removeTerm: () => void = () => undefined
  let settle: ((code: number) => void) | undefined
  let abortWait: (() => void) | undefined

  const finish = (code: number) => {
    if (!running) return
    running = false
    pending.length = 0
    unsubscribe()
    abortWait?.()
    settle?.(code)
  }

  try {
    io.enterRaw()
    io.write(ALT_ENTER)
    if (options.intro) await playIntro()
    const onTerm = () => finish(0)
    process.on('SIGTERM', onTerm)
    removeTerm = () => {
      process.removeListener('SIGTERM', onTerm)
      removeTerm = () => undefined
    }
    paint()
    await Promise.race([
      refreshQuota(),
      new Promise<void>((resolve) => { abortWait = resolve }),
    ])
    if (!running) return 0
    state = withChrome(state)
    return await new Promise<number>((resolve, reject) => {
      settle = resolve

      paint()

      const fail = (err: unknown) => {
        if (!running) return
        running = false
        pending.length = 0
        unsubscribe()
        reject(err)
      }

      const persistOpen = (boundId: string) => {
        writeSession({ ...readSession(), last_conversation_id: boundId })
      }

      const openConversation = async (id: string) => {
        pickMode = false
        newConversation = false
        persistOpen(id)
        state = withChrome({ ...state, conversationId: id, entries: [], selected: 0 })
        try {
          const row = await transport.getConversation(id)
          if (!running) return
          const bound = row.id || id
          persistOpen(bound)
          const mapped = entriesFromMessages(row.messages)
          const seeded = mapped.entries.map((entry) => {
            const next = { ...entry, id: `p${nextAppEntryId}` }
            nextAppEntryId += 1
            return next
          })
          const entries = mapped.truncated
            ? [...seeded, { id: `p${nextAppEntryId++}`, kind: 'status' as const, text: 'showing last 200 messages', folded: false }]
            : seeded
          state = withChrome({
            ...state,
            conversationId: bound,
            entries,
            selected: Math.max(0, entries.length - 1),
          })
        } catch (err) {
          if (!running) return
          state = pushEntry(state, 'status', err instanceof Error ? err.message : String(err))
          state = withChrome(state)
        }
      }

      const submitSlash = async (text: string): Promise<void> => {
        const head = commandHead(text)
        state = clearDraft(state)
        if (head === '/quit') {
          finish(0)
          return
        }
        if (head === '/login') {
          if (!options.login) {
            state = pushEntry(state, 'status', 'not wired')
            paint()
            return
          }
          state = pushEntry(state, 'status', 'Opening browser to sign in…')
          paint()
          try {
            const email = await options.login((line) => {
              if (!running) return
              state = pushEntry(state, 'status', line)
              paint()
            })
            if (!running) return
            chromeEmail = email
            state = withChrome(state)
            state = pushEntry(state, 'status', `logged in as ${email}`)
          } catch (err) {
            if (!running) return
            state = pushEntry(state, 'status', err instanceof Error ? err.message : String(err))
          }
          paint()
          return
        }
        if (head === '/new') {
          pickMode = false
          pickableIds.clear()
          state = withChrome({
            ...state,
            entries: [],
            selected: 0,
            conversationId: '',
          })
          newConversation = true
          paint()
          return
        }
        if (head === '/resume') {
          pickMode = false
          pickableIds.clear()
          try {
            const rowsList = await transport.listConversations()
            if (!running) return
            if (!rowsList.length) {
              state = pushEntry(state, 'status', 'no conversations')
            } else {
              pickMode = true
              // API is last_activity_at DESC (newest first). Append oldest-first so
              // the newest row is last, selected, and visible above the prompt.
              const oldestFirst = rowsList.slice().reverse()
              oldestFirst.forEach((row, index) => {
                const client = row.client ? ` [${row.client}]` : ''
                state = pushEntry(state, 'status', `${index + 1}. ${row.id}  ${row.title}${client}`)
                const entry = state.entries[state.entries.length - 1]
                if (row.id) pickableIds.set(entry.id, row.id)
              })
            }
          } catch (err) {
            if (!running) return
            state = pushEntry(state, 'status', err instanceof Error ? err.message : String(err))
          }
          paint()
          return
        }
        if (head === '/open') {
          const id = text.slice('/open'.length).trim()
          if (!id) {
            state = pushEntry(state, 'status', 'usage: /open <id>')
          } else {
            await openConversation(id)
          }
          paint()
          return
        }
        if (head === '/status') {
          const body = options.status ? await resolveText(options.status()) : 'not wired'
          if (!running) return
          state = pushEntry(state, 'status', body)
          paint()
          return
        }
        if (head === '/ls') {
          const body = options.ls ? await resolveText(options.ls()) : 'not wired'
          if (!running) return
          state = pushEntry(state, 'status', body)
          paint()
          return
        }
        if (head === '/training') {
          const arg = text.slice('/training'.length).trim()
          if (!options.training) {
            state = pushEntry(state, 'status', 'not wired')
          } else if (arg !== 'on' && arg !== 'off') {
            state = pushEntry(state, 'status', 'usage: /training on|off')
          } else {
            const body = await resolveText(options.training(arg === 'on'))
            if (!running) return
            state = pushEntry(state, 'status', body)
          }
          paint()
          return
        }
        if (head === '/theme') {
          theme = theme === 'dark' ? 'light' : 'dark'
          state = pushEntry(state, 'status', `theme ${theme}`)
          paint()
          return
        }
        if (head === '/help') {
          state = pushEntry(
            state,
            'status',
            SLASH_COMMANDS.map((item) => `${item.name}  ${item.hint}`).join('\n'),
          )
          paint()
          return
        }
        state = pushEntry(state, 'status', `unknown command ${text}`)
        paint()
      }

      const sendTurn = async (prompt: string): Promise<void> => {
        if (!chromeEmail && options.login) {
          state = pushEntry(state, 'status', 'Not logged in. Type /login to sign in.')
          state = clearDraft(state)
          paint()
          return
        }
        state = pushEntry(state, 'user', prompt)
        state = startAssistant(state)
        state = clearDraft(state)
        paint()
        const sendOptions = {
          conversationId: newConversation ? undefined : state.conversationId || undefined,
          newConversation,
        }
        try {
          const gen = transport.send(prompt, sendOptions)
          let step = await gen.next()
          while (running && !step.done) {
            const event = step.value
            if (event.type === 'bound' && event.text) {
              state = withChrome({ ...state, conversationId: event.text })
              newConversation = false
            } else if (event.type === 'text' && event.text) {
              state = appendText(state, event.text)
            } else if (event.type === 'error') {
              state = pushEntry(state, 'status', event.text || 'stream error')
            } else if (event.type === 'status' && event.text) {
              state = pushEntry(state, 'status', event.text)
            } else if (event.type === 'tool' && event.text) {
              const folded = event.text.split('\n').length > 8
              const entry = { id: `p${nextAppEntryId}`, kind: 'tool' as const, text: event.text, folded }
              nextAppEntryId += 1
              state = insertToolBeforeLiveAssistant(state, entry)
            }
            paint()
            if (!running) return
            step = await gen.next()
          }
          if (!running || !step.done) return
          const conversationId = step.value.conversationId
          if (conversationId) {
            state = withChrome({ ...state, conversationId })
            newConversation = false
          }
          await refreshQuota()
          state = withChrome(state)
          paint()
        } catch (err) {
          if (!running) return
          state = pushEntry(state, 'status', err instanceof Error ? err.message : String(err))
          await refreshQuota()
          state = withChrome(state)
          paint()
        }
      }

      const handleKey = async (key: PagerKey): Promise<void> => {
        if (!running) return
        if (key.type === 'escape' && !state.slashOpen && state.draft === '') {
          finish(0)
          return
        }
        if (key.type === 'enter') {
          const text = submittedText(state)
          if (!text) {
            const selected = state.entries[state.selected]
            const picked = pickMode && selected ? pickableIds.get(selected.id) : undefined
            if (picked) {
              await openConversation(picked)
              paint()
              return
            }
            state = applyKey(state, key)
            paint()
            return
          }
          if (text.startsWith('/')) {
            await submitSlash(text)
            return
          }
          await sendTurn(text)
          return
        }
        state = applyKey(state, key)
        paint()
      }

      const drain = async () => {
        if (processing) return
        processing = true
        try {
          while (running && pending.length) {
            const key = pending.shift()
            if (!key) break
            await handleKey(key)
          }
        } catch (err) {
          fail(err)
        } finally {
          processing = false
          if (running && pending.length) void drain()
        }
      }

      unsubscribe = io.onData((chunk) => {
        const decoded = decodeKeys(rest + chunk)
        rest = decoded.rest
        pending.push(...decoded.keys)
        void drain()
      })
      options.ready?.()
    })
  } finally {
    running = false
    removeTerm()
    try {
      io.write(ALT_LEAVE)
    } finally {
      io.leaveRaw()
    }
  }
}
