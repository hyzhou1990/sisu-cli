import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  execCommand,
  formatQuota,
  listConversationsCommand,
  listLocalCommand,
  listModelsCommand,
  loginCommand,
  logoutCommand,
  openBrowserSafely,
  openCommand,
  openConversationCommand,
  resolveVerificationUrl,
  setModelCommand,
  statusCommand,
  webLoginCommand,
} from './commands'
import { readAuth, readSession, writeAuth } from './store'

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-cmd-'))
}

describe('sisu commands', () => {
  const previous = process.env.SISU_HOME

  afterEach(() => {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
  })

  it('logs in against /api/auth/login and can log out', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const http = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'jwt-token',
        user: { id: 'u1', email: 'ada@example.com', plan_code: 'pro' },
      }),
      text: async () => '',
    })

    const email = await loginCommand(
      { email: 'ada@example.com', password: 'secret', apiBase: 'https://www.sisu.chat' },
      http,
    )
    expect(email).toBe('ada@example.com')
    expect(http).toHaveBeenCalledWith(
      'https://www.sisu.chat/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(readAuth()?.token).toBe('jwt-token')
    expect(await statusCommand()).toContain('user ada@example.com (pro)')

    logoutCommand()
    expect(readAuth()).toBeNull()
    expect(await statusCommand()).toContain('user logged out')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('completes a web device login by polling then persists via /auth/me', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const http = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'dev-1',
          user_code: 'AB12-CD34',
          verification_uri: 'https://www.sisu.chat/api/auth/cli/verify',
          verification_uri_complete: 'https://www.sisu.chat/api/auth/cli/verify?user_code=AB12-CD34',
          interval: 0,
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 428,
        json: async () => ({ detail: 'authorization_pending' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'jwt-web', user: { email: 'ada@example.com' } }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'u1', email: 'ada@example.com', plan_code: 'pro' }),
        text: async () => '',
      })
    const opened: string[] = []
    const email = await webLoginCommand({
      apiBase: 'https://www.sisu.chat',
      openBrowser: (url) => { opened.push(url) },
      sleep: async () => undefined,
    }, http)
    expect(email).toBe('ada@example.com')
    expect(opened[0]).toContain('user_code=AB12-CD34')
    expect(http.mock.calls[0][0]).toBe('https://www.sisu.chat/api/auth/cli/device')
    expect(http.mock.calls[3][0]).toBe('https://www.sisu.chat/api/auth/me')
    expect(readAuth()?.token).toBe('jwt-web')
    expect(await statusCommand()).toContain('user ada@example.com')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('exchanges a pasted grant code and reuses stored identity', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const http = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'jwt-grant', user: { email: 'ada@example.com' } }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'u1', email: 'ada@example.com', plan_code: 'lab' }),
        text: async () => '',
      })
    await webLoginCommand({ grantCode: 'GRANT-9', apiBase: 'https://www.sisu.chat', openBrowser: () => undefined }, http)
    expect(http.mock.calls[0][0]).toContain('/api/auth/cli/device/exchange')
    expect(readAuth()?.token).toBe('jwt-grant')
    expect(await statusCommand()).toContain('user ada@example.com')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('keeps polling for the server-advertised lifetime instead of a two-minute cap', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    let polls = 0
    const http = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/cli/device')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            device_code: 'dev-ttl',
            user_code: 'AA11-BB22',
            verification_uri: 'https://www.sisu.chat/api/auth/cli/verify',
            verification_uri_complete: 'https://www.sisu.chat/api/auth/cli/verify?user_code=AA11-BB22',
            interval: 1,
            expires_in: 3,
          }),
          text: async (): Promise<string> => '',
        }
      }
      polls += 1
      return {
        ok: false,
        status: 428,
        json: async () => ({ detail: 'authorization_pending' }),
        text: async (): Promise<string> => '',
      }
    })
    await expect(webLoginCommand({
      apiBase: 'https://www.sisu.chat',
      openBrowser: () => undefined,
      sleep: async () => undefined,
    }, http)).rejects.toThrow(/timed out/)
    expect(polls).toBe(3)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('resolves a relative verify path against the selected apiBase', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const opened: string[] = []
    const http = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'dev-rel',
          user_code: 'AA11-BB22',
          verification_uri: '/api/auth/cli/verify',
          verification_uri_complete: '/api/auth/cli/verify?user_code=AA11-BB22',
          interval: 0,
        }),
        text: async (): Promise<string> => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'jwt-web', user: { email: 'ada@example.com' } }),
        text: async (): Promise<string> => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'u1', email: 'ada@example.com' }),
        text: async (): Promise<string> => '',
      })
    await webLoginCommand({
      apiBase: 'http://127.0.0.1:8000',
      openBrowser: (url) => { opened.push(url) },
      sleep: async () => undefined,
    }, http)
    expect(opened[0]).toBe('http://127.0.0.1:8000/api/auth/cli/verify?user_code=AA11-BB22')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('rewrites a stale production verify host back onto the selected apiBase', () => {
    expect(resolveVerificationUrl(
      'https://www.sisu.chat/api/auth/cli/verify?user_code=AA11-BB22',
      'http://127.0.0.1:8000',
    )).toBe('http://127.0.0.1:8000/api/auth/cli/verify?user_code=AA11-BB22')
  })

  it('opens Windows URLs with explorer.exe instead of cmd.exe', () => {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const fake = ((cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      return {
        on() { return this },
        unref() { return this },
      }
    }) as unknown as typeof import('child_process').spawn
    openBrowserSafely('https://www.sisu.chat/api/auth/cli/verify?user_code=AA-11', fake, 'win32')
    expect(calls[0].cmd).toBe('explorer.exe')
    expect(calls[0].args[0]).toMatch(/^https:\/\//)
    expect(calls.some((item) => item.cmd === 'cmd' || item.cmd === 'cmd.exe')).toBe(false)
  })

  it('does not throw when the desktop opener is missing', () => {
    const fake = ((() => {
      const child = {
        on(event: string, handler: (error: Error) => void) {
          if (event === 'error') handler(Object.assign(new Error('not found'), { code: 'ENOENT' }))
          return child
        },
        unref() { return child },
      }
      return child
    }) as unknown) as typeof import('child_process').spawn
    expect(() => openBrowserSafely('https://www.sisu.chat/api/auth/cli/verify', fake, 'linux')).not.toThrow()
  })

  it('explains a 404 device start instead of dumping Not Found', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const http = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not Found' }),
      text: async () => '',
    })
    await expect(webLoginCommand({
      apiBase: 'https://www.sisu.chat',
      openBrowser: () => undefined,
    }, http)).rejects.toThrow(/not on this server yet/i)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('cancels web login when the device poll is denied', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const http = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'dev-x',
          user_code: 'ZZ-ZZ',
          verification_uri: 'https://www.sisu.chat/api/auth/cli/verify',
          verification_uri_complete: 'https://www.sisu.chat/api/auth/cli/verify?user_code=ZZ-ZZ',
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'access_denied' }),
        text: async () => '',
      })
    await expect(webLoginCommand({
      apiBase: 'https://www.sisu.chat',
      openBrowser: () => undefined,
      sleep: async () => undefined,
    }, http)).rejects.toThrow(/cancelled/)
    expect(readAuth()).toBeNull()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('logs in with a browser token and fetches /auth/me', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const http = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u9', email: 'ada@example.com', plan_code: 'lab' }),
      text: async () => '',
    })
    await loginCommand({ token: 'pasted-jwt', apiBase: 'https://www.sisu.chat' }, http)
    expect(http).toHaveBeenCalledWith(
      'https://www.sisu.chat/api/auth/me',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer pasted-jwt' }) }),
    )
    expect(readAuth()?.plan_code).toBe('lab')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('shows live quota after login', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    writeAuth({
      token: 'jwt-token',
      email: 'ada@example.com',
      user_id: 'u1',
      api_base: 'https://www.sisu.chat',
      plan_code: 'pro',
    })
    const http = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        total: 12000,
        plan: { balance: 8000, plan_name: 'Pro', plan_code: 'pro' },
        wallet: { balance: 3000 },
        bonus: { balance: 1000 },
        allowance: { unlimited: false, limit: 8000, used: 200 },
      }),
      text: async () => '',
    })
    const text = await statusCommand(http)
    expect(text).toContain('quota 12000 pts')
    expect(text).toContain('wallet 3000')
    expect(http).toHaveBeenCalledWith(
      'https://www.sisu.chat/api/points/balance',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-token' }) }),
    )
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('opens an existing local repo into the shared workspace registry', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-open-'))
    fs.writeFileSync(path.join(repo, 'README.md'), 'x\n')

    const line = openCommand('proj-9', repo)
    expect(line).toContain(repo)
    expect(await statusCommand()).toContain('workspace proj-9')

    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('lists local files only after login and a bound workspace', () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    expect(() => listLocalCommand()).toThrow(/not logged in/)
    writeAuth({ token: 't', email: 'a@b.c', user_id: 'u', api_base: 'https://www.sisu.chat' })
    expect(() => listLocalCommand()).toThrow(/no local workspace/)

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-ls-'))
    fs.writeFileSync(path.join(repo, 'main.py'), 'print(1)\n')
    fs.mkdirSync(path.join(repo, 'src'))
    openCommand('proj-ls', repo)
    const listing = listLocalCommand()
    expect(listing).toContain('main.py')
    expect(listing).toContain('src/')

    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('executes a prompt against the logged-in account and bills via /chat/send', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    writeAuth({ token: 'jwt-token', email: 'ada@example.com', user_id: 'u1', api_base: 'https://www.sisu.chat' })
    const http = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'conv-1' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => 'event: text\ndata: "ok from cloud"\n\n',
      })

    const result = await execCommand('summarize this repo', { newConversation: true }, http)
    expect(result.conversationId).toBe('conv-1')
    expect(result.text).toBe('ok from cloud')
    expect(http.mock.calls[0][0]).toBe('https://www.sisu.chat/api/chat/conversations')
    expect(http.mock.calls[1][0]).toBe('https://www.sisu.chat/api/chat/send')
    expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toMatchObject({
      client: 'cli',
      client_version: require('../package.json').version,
    })
    expect(JSON.parse(String(http.mock.calls[1][1]?.body))).toMatchObject({
      conversation_id: 'conv-1',
      message: 'summarize this repo',
      client: 'cli',
    })
    expect(JSON.parse(String(http.mock.calls[1][1]?.body)).client_request_id).toBeTruthy()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('lists and switches models from /api/chat/models', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    writeAuth({ token: 'tok', email: 'ada@example.com', user_id: 'u1', api_base: 'https://www.sisu.chat' })
    const http = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        default_model: 'grok-4.6',
        models: [
          { name: 'grok-4.6', display_name: 'Grok 4.6' },
          { name: 'kimi-code', display_name: 'Kimi Code' },
        ],
      }),
    })
    const listed = await listModelsCommand(http)
    expect(listed).toContain('* grok-4.6')
    expect(listed).toContain('kimi-code')
    expect(await setModelCommand('Kimi Code', http)).toBe('model kimi-code')
    expect(readSession().last_model).toBe('kimi-code')
    await expect(setModelCommand('nope', http)).rejects.toThrow(/unknown model/)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('lists cloud conversations and opens one locally', async () => {
    const home = makeHome()
    process.env.SISU_HOME = home
    writeAuth({ token: 'jwt-token', email: 'ada@example.com', user_id: 'u1', api_base: 'https://www.sisu.chat' })
    const http = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'conv-9', title: 'prior', client: 'tui' }],
      text: async () => '',
    })
    expect(await listConversationsCommand(http)).toContain('conv-9  prior [tui]')
    expect(openConversationCommand('conv-9')).toBe('opened conv-9')
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('formatQuota', () => {
  it('formats a normal and unlimited balance', () => {
    expect(formatQuota({
      total: 10,
      plan: { balance: 4, plan_name: 'Lab' },
      wallet: { balance: 6 },
      bonus: { balance: 0 },
      allowance: { unlimited: false, limit: 4, used: 1 },
    })).toContain('quota 10 pts')
    expect(formatQuota({ allowance: { unlimited: true } })).toBe('quota unlimited')
  })
})
