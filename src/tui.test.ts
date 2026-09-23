import fs from 'fs'
import os from 'os'
import path from 'path'

import { NATIVE_PAGER_FALLBACK_NOTICE, runTui, TUI_REQUIRES_TTY_NOTICE } from './tui'

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

const account = { token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' }

const healthyHttp = () =>
  jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, complete: true, models: true }),
  })

describe('sisu tui', () => {
  it('signs in at startup when logged out, then spawns the native pager', async () => {
    const { io, written } = scriptedIo([])
    const webLogin = jest.fn(async (input: { onStart?: (info: { verification_uri: string; verification_uri_complete: string; user_code: string }) => void } = {}) => {
      input.onStart?.({
        verification_uri: 'https://www.sisu.chat/api/auth/cli/verify',
        verification_uri_complete: 'https://www.sisu.chat/api/auth/cli/verify?user_code=AA-11',
        user_code: 'AA-11',
      })
      return 'ada@sisu.chat'
    })
    const auth = jest.fn().mockReturnValueOnce(null).mockReturnValue(account)
    const spawnGrokPager = jest.fn().mockResolvedValue(0)
    const code = await runTui(io, { auth, webLogin, spawnGrokPager, http: healthyHttp() })
    expect(code).toBe(0)
    expect(webLogin).toHaveBeenCalledTimes(1)
    expect(spawnGrokPager).toHaveBeenCalledWith([])
    expect(written.join('')).toMatch(/Open https:\/\/www\.sisu\.chat\/api\/auth\/cli\/verify/)
    expect(written.join('')).toMatch(/logged in as ada@sisu\.chat/)
  })

  it('fails hard when the runtime health probe fails and never spawns the pager', async () => {
    const { io, written } = scriptedIo([])
    const spawnGrokPager = jest.fn()
    const code = await runTui(io, {
      auth: () => account,
      spawnGrokPager,
      http: jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    })
    expect(code).toBe(1)
    expect(spawnGrokPager).not.toHaveBeenCalled()
    expect(written.join('')).toMatch(/SiSu runtime is not available/)
    expect(written.join('')).not.toMatch(/fallback shell — not the full SiSu TUI/)
  })

  it('refuses the interactive TUI without a terminal and points at sisu exec', async () => {
    const { io, written } = scriptedIo([])
    const probe = jest.fn()
    const webLogin = jest.fn()
    const code = await runTui(io, {
      auth: () => account,
      webLogin,
      probe,
      http: healthyHttp(),
    })
    expect(code).toBe(1)
    expect(webLogin).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(written.join('')).toContain(TUI_REQUIRES_TTY_NOTICE.trim())
    expect(written.join('')).toContain('sisu exec "<prompt>"')
  })

  it('fails hard when the pager cannot be spawned at the last moment', async () => {
    const { io, written } = scriptedIo([])
    const spawnGrokPager = jest.fn().mockResolvedValue(null)
    const code = await runTui(io, {
      auth: () => account,
      spawnGrokPager,
      http: healthyHttp(),
    })
    expect(code).toBe(1)
    expect(spawnGrokPager).toHaveBeenCalledTimes(1)
    expect(written.join('')).toContain(NATIVE_PAGER_FALLBACK_NOTICE.trim())
  })

  it('returns the native pager exit code', async () => {
    const { io } = scriptedIo([])
    const spawnGrokPager = jest.fn().mockResolvedValue(42)
    const code = await runTui(io, {
      auth: () => account,
      spawnGrokPager,
      http: healthyHttp(),
    })
    expect(code).toBe(42)
    expect(spawnGrokPager).toHaveBeenCalledWith([])
  })

  it('does not open another browser login when a session already exists', async () => {
    const { io } = scriptedIo([])
    const webLogin = jest.fn()
    const spawnGrokPager = jest.fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(0)
    const code = await runTui(io, {
      auth: () => account,
      webLogin,
      spawnGrokPager,
      http: healthyHttp(),
    })
    expect(code).toBe(0)
    expect(spawnGrokPager).toHaveBeenCalledTimes(2)
    expect(spawnGrokPager).toHaveBeenCalledWith([])
    expect(webLogin).not.toHaveBeenCalled()
  })

  it('passes --resume to the grok pager so exit hints work as sisu --resume', async () => {
    const { io } = scriptedIo([])
    const spawnGrokPager = jest.fn().mockResolvedValue(0)
    const code = await runTui(io, {
      auth: () => account,
      spawnGrokPager,
      http: healthyHttp(),
      pagerArgs: ['--resume', '01a07c14-4b74-7460-8885-09183ee5d261'],
    })
    expect(code).toBe(0)
    expect(spawnGrokPager).toHaveBeenCalledWith(['--resume', '01a07c14-4b74-7460-8885-09183ee5d261'])
  })

  it('does not mint a second device login after the startup browser login', async () => {
    const { io } = scriptedIo([])
    let session: { token: string; email: string; user_id: string; api_base: string } | null = null
    const webLogin = jest.fn(async () => {
      session = account
      return 'ada@sisu.chat'
    })
    const spawnGrokPager = jest.fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(0)
    const code = await runTui(io, {
      auth: () => session,
      webLogin,
      spawnGrokPager,
      http: healthyHttp(),
    })
    expect(code).toBe(0)
    expect(webLogin).toHaveBeenCalledTimes(1)
    expect(spawnGrokPager).toHaveBeenCalledTimes(2)
  })

  it('stays on grok pager after exit 10 when a session is already saved', async () => {
    const { io, written } = scriptedIo([])
    const spawnGrokPager = jest.fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(0)
    const code = await runTui(io, {
      auth: () => account,
      webLogin: jest.fn(),
      spawnGrokPager,
      http: healthyHttp(),
    })
    expect(code).toBe(0)
    expect(spawnGrokPager).toHaveBeenCalledTimes(2)
    expect(written.join('')).not.toMatch(/session already saved/)
  })

  it('exits when the native pager cannot load instead of opening the fallback shell', async () => {
    const { io, written } = scriptedIo([])
    const previousBin = process.env.SISU_GROK_BIN
    const previousTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-pager-missing-'))
    const dest = path.join(fake, 'xai-grok-pager')
    fs.writeFileSync(dest, 'elf')
    process.env.SISU_GROK_BIN = dest
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      const code = await runTui(io, {
        auth: () => account,
        pagerRunnable: () => false,
        http: healthyHttp(),
      })
      expect(code).toBe(1)
      expect(written.join('')).toContain(NATIVE_PAGER_FALLBACK_NOTICE.trim())
      expect(written.join('')).not.toMatch(/fallback shell — not the full SiSu TUI/)
    } finally {
      if (previousBin === undefined) delete process.env.SISU_GROK_BIN
      else process.env.SISU_GROK_BIN = previousBin
      if (previousTty) Object.defineProperty(process.stdout, 'isTTY', previousTty)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
      fs.rmSync(fake, { recursive: true, force: true })
    }
  })

  it('tells the user to reinstall when a native pager binary cannot exec', async () => {
    const { io, written } = scriptedIo([])
    const previousBin = process.env.SISU_GROK_BIN
    const previousTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-pager-bin-'))
    const dest = path.join(fake, 'xai-grok-pager')
    fs.writeFileSync(dest, 'elf')
    process.env.SISU_GROK_BIN = dest
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      const code = await runTui(io, {
        auth: () => account,
        pagerRunnable: () => false,
        http: healthyHttp(),
      })
      expect(code).toBe(1)
      expect(written.join('')).toContain(NATIVE_PAGER_FALLBACK_NOTICE.trim())
      expect(written.join('')).toMatch(/sisu update/)
    } finally {
      if (previousBin === undefined) delete process.env.SISU_GROK_BIN
      else process.env.SISU_GROK_BIN = previousBin
      if (previousTty) Object.defineProperty(process.stdout, 'isTTY', previousTty)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
      fs.rmSync(fake, { recursive: true, force: true })
    }
  })

  it('stays a failed launch when the grok pager keeps exiting 10', async () => {
    const { io, written } = scriptedIo([])
    const spawnGrokPager = jest.fn().mockResolvedValue(10)
    const code = await runTui(io, {
      auth: () => account,
      webLogin: jest.fn(),
      spawnGrokPager,
      http: healthyHttp(),
    })
    expect(code).toBe(10)
    expect(spawnGrokPager).toHaveBeenCalledTimes(2)
    expect(written.join('')).toMatch(/still requesting login/)
  })
})
