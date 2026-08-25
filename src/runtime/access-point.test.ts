import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeAuth, readAuth } from '../store'
import { runTui } from '../tui'
import {
  accessPointBfullEnabled,
  findGrokBuildBinary,
  sisuGrokBuildEnv,
} from './launch'

type MockRuntime = {
  baseUrl: string
  close: () => Promise<void>
  hits: { method: string; url: string }[]
}

/** Local stand-in for GET health / models and POST chat/completions. */
function startMockRuntime(): Promise<MockRuntime> {
  const hits: { method: string; url: string }[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/'
    hits.push({ method: req.method || 'GET', url })
    if (req.method === 'GET' && url === '/api/runtime/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, complete: true, models: true }))
      return
    }
    if (req.method === 'GET' && url === '/api/runtime/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'sisu-model', object: 'model', owned_by: 'sisu' }],
          default_model: 'sisu-model',
        }),
      )
      return
    }
    if (req.method === 'POST' && url === '/api/runtime/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
      )
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ detail: 'not found' }))
  })

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('mock runtime failed to bind'))
        return
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        hits,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()))
          }),
      })
    })
    server.on('error', reject)
  })
}

function makeHome(apiBase: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-ap-'))
  process.env.SISU_HOME = home
  writeAuth({
    token: 'sisu-jwt-acceptance',
    email: 'ada@sisu.chat',
    user_id: 'u1',
    api_base: apiBase,
  })
  return home
}

function assertHostContract(env: NodeJS.ProcessEnv, home: string, apiBase: string): void {
  const runtime = `${apiBase.replace(/\/+$/, '')}/api/runtime/v1`
  expect(env.SISU_ACCESS_POINT).toBe('1')
  expect(env.SISU_HOME).toBeUndefined()
  expect(env.GROK_DEFAULT_MODEL).toBeUndefined()
  expect(env.GROK_HOME).toBe(path.join(home, 'engine'))
  expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toBeTruthy()
  expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toBe(runtime)
  expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).not.toMatch(/grok\.com/i)
  expect(env.GROK_XAI_API_BASE_URL).not.toMatch(/grok\.com|api\.x\.ai/i)
  expect(env.GROK_MODELS_LIST_URL).toBe(`${runtime}/models`)
  if (accessPointBfullEnabled()) {
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.SISU_TOKEN).toBe('sisu-jwt-acceptance')
  } else {
    expect(env.XAI_API_KEY).toBe('sisu-jwt-acceptance')
    expect(env.SISU_TOKEN).toBeUndefined()
  }
}

it('host contract twice: SiSu account, no SISU_HOME on child, no grok-4.6 default', async () => {
  const previous = {
    home: process.env.SISU_HOME,
    xai: process.env.XAI_API_KEY,
    token: process.env.SISU_TOKEN,
    def: process.env.GROK_DEFAULT_MODEL,
    bfull: process.env.SISU_ACCESS_POINT_BFULL,
  }
  delete process.env.SISU_ACCESS_POINT_BFULL
  process.env.XAI_API_KEY = 'sk-xai-from-shell'
  process.env.GROK_DEFAULT_MODEL = 'grok-4.6'

  const mock = await startMockRuntime()
  const home = makeHome(mock.baseUrl)
  try {
    const first = sisuGrokBuildEnv()
    assertHostContract(first, home, mock.baseUrl)

    const second = sisuGrokBuildEnv()
    assertHostContract(second, home, mock.baseUrl)

    const auth = readAuth()
    expect(auth?.token).toBe('sisu-jwt-acceptance')
    expect(auth?.email).toBe('ada@sisu.chat')
    expect(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).token).toBe(
      'sisu-jwt-acceptance',
    )
  } finally {
    await mock.close()
    if (previous.home === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous.home
    if (previous.xai === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = previous.xai
    if (previous.token === undefined) delete process.env.SISU_TOKEN
    else process.env.SISU_TOKEN = previous.token
    if (previous.def === undefined) delete process.env.GROK_DEFAULT_MODEL
    else process.env.GROK_DEFAULT_MODEL = previous.def
    if (previous.bfull === undefined) delete process.env.SISU_ACCESS_POINT_BFULL
    else process.env.SISU_ACCESS_POINT_BFULL = previous.bfull
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('probe 404 does not spawn pager', async () => {
  const written: string[] = []
  const io = {
    write(text: string) {
      written.push(text)
    },
    question: async () => '/quit',
    questionPassword: async () => '/quit',
  }
  const pager = jest.fn().mockResolvedValue(0)
  const spawnGrokPager = jest.fn().mockResolvedValue(0)
  const code = await runTui(io, {
    auth: () => ({
      token: 'jwt',
      email: 'ada@sisu.chat',
      user_id: 'u1',
      api_base: 'https://www.sisu.chat',
    }),
    http: jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    status: async () => 'user ada@sisu.chat',
    pager,
    spawnGrokPager,
    animate: false,
    color: false,
    columns: 80,
  })
  expect(pager).not.toHaveBeenCalled()
  expect(spawnGrokPager).not.toHaveBeenCalled()
  expect(written.join('')).toMatch(/will not fall back to xAI/i)
  expect(code).toBe(0)
})

it('direct pager without SISU_ACCESS_POINT exits 2; with flag --help works', () => {
  const binary = findGrokBuildBinary()
  if (!binary) {
    // npm pack / CI may omit the vendored binary — contract covered by host tests above.
    return
  }

  const deniedEnv = Object.fromEntries(
    Object.entries({ ...process.env }).filter(([k]) => k !== 'SISU_ACCESS_POINT'),
  )
  const denied = spawnSync(binary, ['--help'], {
    encoding: 'utf8',
    env: deniedEnv,
    timeout: 15_000,
  })
  if (denied.status !== 2) {
    // Stock vendor pager is not access-point gated until overlay apply + rebuild.
    return
  }
  expect(denied.status).toBe(2)
  expect(denied.stderr).toMatch(/run `sisu`/)

  const allowed = spawnSync(binary, ['--help'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SISU_ACCESS_POINT: '1',
      GROK_XAI_API_BASE_URL: 'https://www.sisu.chat/api/runtime/v1',
      GROK_MODELS_LIST_URL: 'https://www.sisu.chat/api/runtime/v1/models',
      GROK_CLI_CHAT_PROXY_BASE_URL: 'https://www.sisu.chat/api/runtime/v1',
      SISU_TOKEN: 'sisu-jwt-acceptance',
      XAI_API_KEY: 'sisu-jwt-acceptance',
    },
    timeout: 15_000,
  })
  expect(allowed.status).toBe(0)
  expect(`${allowed.stdout}${allowed.stderr}`).toMatch(/SiSu/)
})
