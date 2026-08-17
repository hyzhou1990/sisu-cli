import { playMobiusIntro, playTreeIntro, runTui, shouldAnimateSplash, tuiHelp } from './tui'

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
  it('enters the pager logged out and does not ask for email', async () => {
    const { io, written } = scriptedIo([])
    const pager = jest.fn().mockResolvedValue(0)
    const code = await runTui(io, {
      auth: () => null,
      pager,
      columns: 80,
      animate: false,
      color: false,
    })
    expect(code).toBe(0)
    expect(written.join('')).toMatch(/思溯|思有所溯/)
    expect(written.join('')).not.toMatch(/Email:/)
    expect(pager).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ login: expect.any(Function) }),
    )
  })

  it('signs in from /login in the line TUI', async () => {
    const { io, written } = scriptedIo(['/login', '/quit'])
    const webLogin = jest.fn(async (input: { onStart?: (info: { verification_uri: string; verification_uri_complete: string; user_code: string }) => void } = {}) => {
      input.onStart?.({
        verification_uri: 'https://www.sisu.chat/api/auth/cli/verify',
        verification_uri_complete: 'https://www.sisu.chat/api/auth/cli/verify?user_code=AA-11',
        user_code: 'AA-11',
      })
      return 'ada@b.c'
    })
    const code = await runTui(io, {
      auth: () => null,
      webLogin,
      animate: false,
      color: false,
      columns: 80,
      status: async () => 'user logged out',
      exec: jest.fn(),
    })
    expect(code).toBe(0)
    expect(webLogin).toHaveBeenCalled()
    expect(written.join('')).toMatch(/Open https:\/\/www\.sisu\.chat\/api\/auth\/cli\/verify/)
    expect(written.join('')).toMatch(/logged in as ada@b\.c/)
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

  it('animates the ∞ Möbius so the half-twist travels', async () => {
    const { io, written } = scriptedIo([])
    await playTreeIntro(io, {
      columns: 72,
      frames: 6,
      color: false,
      sleep: async () => undefined,
    })
    const out = written.join('')
    expect(out).toContain('\x1b[?25l')
    expect((out.match(/\x1b\[\d+A/g) || []).length).toBe(5)
    expect(out).toMatch(/思溯/)
    expect(out).toMatch(/思有所溯/)
    expect(out).not.toMatch(/NaN/)
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
    expect(out).toMatch(/思溯/)
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
