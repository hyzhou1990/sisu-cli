import { helpText, runCli } from './main'
import { readAuth } from './store'
import fs from 'fs'
import os from 'os'
import path from 'path'

it('names the web login path plus email/password/token in help', () => {
  const text = helpText()
  expect(text).toMatch(/npm install -g @stevezhou\/sisu/)
  expect(text).toMatch(/browser/i)
  expect(text).toMatch(/--code/)
  expect(text).toMatch(/--email/)
  expect(text).toMatch(/--password/)
  expect(text).toMatch(/--token/)
  expect(text).toContain('思溯')
  expect(text).toContain('SiSu')
  expect(text).toContain('思有所溯')
  expect(text).not.toMatch(/Grok Build|SpaceXAI/)
})

it('runCli --version names SiSu, not Grok', async () => {
  const writes: string[] = []
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  try {
    const code = await runCli(['--version'])
    expect(code).toBe(0)
    const text = writes.join('')
    expect(text).toMatch(/^sisu /)
    expect(text).toContain('思溯')
    expect(text).toContain('SiSu')
    expect(text).toContain('思有所溯')
    expect(text).not.toMatch(/Grok Build|SpaceXAI/)
  } finally {
    stdout.mockRestore()
  }
})

it('runCli --help prints the web login path', async () => {
  const writes: string[] = []
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  try {
    const code = await runCli(['--help'])
    expect(code).toBe(0)
    expect(writes.join('')).toMatch(/browser/i)
    expect(writes.join('')).toMatch(/--token/)
  } finally {
    stdout.mockRestore()
  }
})

it('runCli login without flags starts the browser/device path', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-main-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  const writes: string[] = []
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  const http = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        device_code: 'dev-cli',
        user_code: 'AA11-BB22',
        verification_uri: 'https://www.sisu.chat/api/auth/cli/verify',
        verification_uri_complete: 'https://www.sisu.chat/api/auth/cli/verify?user_code=AA11-BB22',
        interval: 0,
      }),
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
      json: async () => ({ id: 'u', email: 'ada@example.com', plan_code: 'pro' }),
      text: async () => '',
    })
  try {
    const code = await runCli(['login', '--api', 'https://www.sisu.chat'], { http })
    expect(code).toBe(0)
    expect(writes.join('')).toMatch(/Open https:\/\/www\.sisu\.chat\/api\/auth\/cli\/verify\?user_code=AA11-BB22/)
    expect(writes.join('')).toMatch(/logged in as ada@example.com/)
    expect(readAuth()?.token).toBe('jwt-web')
    expect(readAuth()?.email).toBe('ada@example.com')
  } finally {
    stdout.mockRestore()
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('runCli login --code wins over SISU_TOKEN', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-main-'))
  const previousHome = process.env.SISU_HOME
  const previousToken = process.env.SISU_TOKEN
  process.env.SISU_HOME = home
  process.env.SISU_TOKEN = 'env-jwt'
  const writes: string[] = []
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
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
      json: async () => ({ id: 'u', email: 'ada@example.com', plan_code: 'pro' }),
      text: async () => '',
    })
  try {
    const code = await runCli(['login', '--code', 'GRANT-9', '--api', 'https://www.sisu.chat'], { http })
    expect(code).toBe(0)
    expect(http.mock.calls[0][0]).toContain('/api/auth/cli/device/exchange')
    expect(writes.join('')).toMatch(/logged in as ada@example.com/)
    expect(readAuth()?.token).toBe('jwt-grant')
  } finally {
    stdout.mockRestore()
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousToken === undefined) delete process.env.SISU_TOKEN
    else process.env.SISU_TOKEN = previousToken
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('runCli login --token still prints logged in as', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-main-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  const writes: string[] = []
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  const http = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'u', email: 'ada@example.com', plan_code: 'pro' }),
    text: async () => '',
  })
  try {
    const code = await runCli(['login', '--token', 'pasted-jwt', '--api', 'https://www.sisu.chat'], { http })
    expect(code).toBe(0)
    expect(writes.join('')).toMatch(/logged in as ada@example.com/)
    expect(readAuth()?.token).toBe('pasted-jwt')
  } finally {
    stdout.mockRestore()
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('runCli update invokes pager install with force', async () => {
  const installPager = jest.fn().mockResolvedValue({ ok: true, dest: '/tmp/xai-grok-pager' })
  const writes: string[] = []
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  try {
    const code = await runCli(['update'], { installPager })
    expect(code).toBe(0)
    expect(installPager).toHaveBeenCalledWith({ force: true })
    expect(writes.join('')).toMatch(/pager/i)
  } finally {
    stdout.mockRestore()
  }
})

it('help lists sisu update', () => {
  expect(helpText()).toMatch(/sisu update/)
  expect(helpText()).toMatch(/stamped local pager/)
  expect(helpText()).toMatch(/\/api\/runtime\/v1\/models/)
  expect(helpText()).not.toMatch(/\/api\/chat\/models/)
  expect(helpText()).not.toMatch(/grok login|grok OAuth|auth\.x\.ai/i)
})

it('runCli -p with empty model text exits 1 and writes stderr', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-main-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  const { writeAuth } = require('./store') as typeof import('./store')
  writeAuth({ token: 'jwt', email: 'ada@example.com', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const stdout: string[] = []
  const stderr: string[] = []
  const out = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  const err = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  const http = jest.fn(async (url: string) => {
    if (String(url).includes('/api/runtime/v1/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          default_model: 'sisu-lite',
          data: [{ id: 'sisu-lite', name: 'SiSu-Lite', owned_by: 'sisu' }],
        }),
        text: async () => '',
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => 'event: text\ndata: ""\n\n',
    }
  })
  try {
    const code = await runCli(['-p', 'say hello', '--new'], { http })
    expect(code).toBe(1)
    expect(stdout.join('').trim()).toBe('')
    expect(stderr.join('')).toMatch(/no model text/)
  } finally {
    out.mockRestore()
    err.mockRestore()
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
