import { playMobiusIntro, runTui, shouldAnimateSplash, tuiHelp } from './tui'

function scriptedIo(answers: string[]) {
  const written: string[] = []
  const next = async () => {
    if (!answers.length) throw new Error('unexpected question')
    return answers.shift() as string
  }
  return {
    written,
    io: {
      write(text: string) {
        written.push(text)
      },
      question: next,
      questionPassword: next,
    },
  }
}

describe('sisu tui', () => {
  it('cancels login when email is empty', async () => {
    const { io, written } = scriptedIo([''])
    const login = jest.fn()
    const pager = jest.fn()
    const code = await runTui(io, {
      auth: () => null,
      login,
      pager,
      columns: 80,
      animate: false,
      color: false,
    })
    expect(code).toBe(2)
    expect(written.join('')).toMatch(/login cancelled/)
    expect(written.join('')).not.toMatch(/Not logged in/)
    expect(login).not.toHaveBeenCalled()
    expect(pager).not.toHaveBeenCalled()
  })

  it('uses injected password I/O even when process.stdin is a TTY', async () => {
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const previous = stdin.isTTY
    stdin.isTTY = true
    const { io, written } = scriptedIo(['ada@b.c', 'secret', '/quit'])
    let loggedIn = false
    try {
      const login = jest.fn(async (input) => {
        loggedIn = true
        expect(input.password).toBe('secret')
        return 'ada@b.c'
      })
      const code = await runTui(io, {
        auth: () => (loggedIn
          ? { token: 't', email: 'ada@b.c', user_id: 'u', api_base: 'https://www.sisu.chat' }
          : null),
        login,
        animate: false,
        color: false,
        columns: 80,
        status: async () => 'user ada@b.c',
        exec: jest.fn(),
      })
      expect(code).toBe(0)
      expect(login).toHaveBeenCalledTimes(1)
      expect(written.join('')).toMatch(/logged in as ada@b\.c/)
    } finally {
      stdin.isTTY = previous
    }
  })

  it('cancels login when password prompt receives Ctrl+C', async () => {
    const { io, written } = scriptedIo(['ada@b.c', '\u0003'])
    const login = jest.fn()
    const pager = jest.fn()
    const code = await runTui(io, {
      auth: () => null,
      login,
      pager,
      columns: 80,
      animate: false,
      color: false,
    })
    expect(code).toBe(2)
    expect(written.join('')).toMatch(/login cancelled/)
    expect(login).not.toHaveBeenCalled()
    expect(pager).not.toHaveBeenCalled()
  })

  it('logs in from the splash prompt and continues', async () => {
    const { io, written } = scriptedIo(['ada@b.c', 'secret', '/quit'])
    let loggedIn = false
    const login = jest.fn(async (input) => {
      loggedIn = true
      expect(input).toMatchObject({ email: 'ada@b.c', password: 'secret' })
      return 'ada@b.c'
    })
    const code = await runTui(io, {
      auth: () => (loggedIn
        ? { token: 't', email: 'ada@b.c', user_id: 'u', api_base: 'https://www.sisu.chat' }
        : null),
      login,
      animate: false,
      color: false,
      columns: 80,
      status: async () => 'user ada@b.c',
      exec: jest.fn(),
    })
    expect(code).toBe(0)
    expect(login).toHaveBeenCalledTimes(1)
    expect(written.join('')).toMatch(/logged in as ada@b\.c/)
  })

  it('exits 2 when login throws and does not start the pager', async () => {
    const { io, written } = scriptedIo(['ada@b.c', 'bad'])
    const login = jest.fn(async () => { throw new Error('login failed (401)') })
    const pager = jest.fn()
    const code = await runTui(io, {
      auth: () => null,
      login,
      pager,
      columns: 80,
      animate: false,
      color: false,
    })
    expect(code).toBe(2)
    expect(written.join('')).toContain('login failed (401)')
    expect(pager).not.toHaveBeenCalled()
  })

  it('routes slash commands and billed prompts', async () => {
    const { io, written } = scriptedIo(['/help', '/status', 'hello from tui', '/quit'])
    const exec = jest.fn().mockResolvedValue({ conversationId: 'c1', text: 'hi back' })
    const code = await runTui(io, {
      auth: () => ({ token: 't', email: 'a@b.c', user_id: 'u', api_base: 'https://www.sisu.chat' }),
      status: async () => 'user a@b.c\nquota 12 pts',
      exec,
      ls: () => 'README.md',
      http: jest.fn(),
      columns: 80,
      animate: false,
      color: false,
    })
    expect(code).toBe(0)
    const out = written.join('')
    expect(out).toContain(tuiHelp().split('\n')[0])
    expect(out).toContain('quota 12 pts')
    expect(out).toContain('hi back')
    expect(out).toContain('bye')
    expect(exec).toHaveBeenCalledWith('hello from tui', { newConversation: false, client: 'tui' }, expect.anything())
  })

  it('lists and opens saved cloud conversations', async () => {
    const { io, written } = scriptedIo(['/history', '/open conv-99', '/quit'])
    const history = jest.fn().mockResolvedValue('conv-99  prior turn [tui]')
    const openThread = jest.fn().mockReturnValue('opened conv-99')
    const code = await runTui(io, {
      auth: () => ({ token: 't', email: 'a@b.c', user_id: 'u', api_base: 'https://www.sisu.chat' }),
      status: async () => 'user a@b.c',
      history,
      openThread,
      exec: jest.fn(),
      http: jest.fn(),
      columns: 80,
      animate: false,
      color: false,
    })
    expect(code).toBe(0)
    expect(history).toHaveBeenCalled()
    expect(openThread).toHaveBeenCalledWith('conv-99')
    expect(written.join('')).toContain('opened conv-99')
  })

  it('animates a rotating Möbius ring before the prompt', async () => {
    const { io, written } = scriptedIo([])
    await playMobiusIntro(io, {
      columns: 48,
      frames: 6,
      color: false,
      sleep: async () => undefined,
    })
    const out = written.join('')
    expect(out).toContain('\x1b[?25l')
    expect((out.match(/\x1b\[\d+A/g) || []).length).toBe(5)
    expect(out).toMatch(/思   溯/)
  })

  it('disables the splash when SISU_TUI_STATIC=1', () => {
    expect(shouldAnimateSplash({ SISU_TUI_STATIC: '1' }, true)).toBe(false)
    expect(shouldAnimateSplash({}, true)).toBe(true)
    expect(shouldAnimateSplash({}, false)).toBe(false)
  })

  it('uses the fullscreen pager on a TTY after splash', async () => {
    const runPager = jest.fn().mockResolvedValue(0)
    const { io } = scriptedIo([])
    const code = await runTui(io, {
      auth: () => ({ token: 't', email: 'a@b.c', user_id: 'u', api_base: 'https://www.sisu.chat' }),
      status: async () => 'user a@b.c',
      animate: true,
      color: false,
      columns: 48,
      sleep: async () => undefined,
      pager: runPager,
      http: jest.fn(),
    })
    expect(code).toBe(0)
    expect(runPager).toHaveBeenCalled()
    expect(runPager).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ email: 'a@b.c' }),
    )
  })
})
