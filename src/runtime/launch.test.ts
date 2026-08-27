import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCli } from '../main'
import { readSession, writeAuth, writeSession } from '../store'
import { execCommand } from '../commands'
import { grokBuildPath } from './suite'
import {
  assertRuntimeAvailable,
  migrateGrokScratchToEngine,
  purgeChangelogCache,
  RuntimeUnavailable,
  pagerStampAllowsSpawn,
  sisuGrokBuildEnv,
  writeSisuGrokConfig,
} from './launch'

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-launch-'))
  process.env.SISU_HOME = home
  writeAuth({
    token: 'jwt',
    email: 'ada@sisu.chat',
    user_id: 'u1',
    api_base: 'https://www.sisu.chat',
  })
  return home
}

it('sisuGrokBuildEnv stamps a stable SISU_CONVERSATION_ID', () => {
  const previousHome = process.env.SISU_HOME
  const previousConv = process.env.SISU_CONVERSATION_ID
  const home = makeHome()
  try {
    delete process.env.SISU_CONVERSATION_ID
    const a = sisuGrokBuildEnv()
    const b = sisuGrokBuildEnv()
    expect(a.SISU_CONVERSATION_ID).toMatch(/^[0-9a-f-]{36}$/i)
    expect(a.SISU_CONVERSATION_ID).toBe(b.SISU_CONVERSATION_ID)
    expect(readSession().last_conversation_id).toBe(a.SISU_CONVERSATION_ID)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousConv === undefined) delete process.env.SISU_CONVERSATION_ID
    else process.env.SISU_CONVERSATION_ID = previousConv
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv keeps a valid UUID last_conversation_id', () => {
  const previousHome = process.env.SISU_HOME
  const previousConv = process.env.SISU_CONVERSATION_ID
  const home = makeHome()
  const kept = '11111111-1111-1111-1111-111111111111'
  try {
    delete process.env.SISU_CONVERSATION_ID
    writeSession({ last_conversation_id: kept, last_model: 'sisu-lite' })
    const env = sisuGrokBuildEnv()
    expect(env.SISU_CONVERSATION_ID).toBe(kept)
    expect(readSession().last_conversation_id).toBe(kept)
    expect(readSession().last_model).toBe('sisu-lite')
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousConv === undefined) delete process.env.SISU_CONVERSATION_ID
    else process.env.SISU_CONVERSATION_ID = previousConv
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv replaces a non-UUID last_conversation_id', () => {
  const previousHome = process.env.SISU_HOME
  const previousConv = process.env.SISU_CONVERSATION_ID
  const home = makeHome()
  try {
    delete process.env.SISU_CONVERSATION_ID
    writeSession({ last_conversation_id: 'conv-99' })
    const env = sisuGrokBuildEnv()
    expect(env.SISU_CONVERSATION_ID).toMatch(/^[0-9a-f-]{36}$/i)
    expect(env.SISU_CONVERSATION_ID).not.toBe('conv-99')
    expect(readSession().last_conversation_id).toBe(env.SISU_CONVERSATION_ID)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousConv === undefined) delete process.env.SISU_CONVERSATION_ID
    else process.env.SISU_CONVERSATION_ID = previousConv
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv unsets GROK_DEFAULT_MODEL', () => {
  const previousHome = process.env.SISU_HOME
  const previousDefault = process.env.GROK_DEFAULT_MODEL
  const home = makeHome()
  try {
    process.env.GROK_DEFAULT_MODEL = 'grok-4.6'
    const env = sisuGrokBuildEnv()
    expect(env.GROK_DEFAULT_MODEL).toBeUndefined()
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousDefault === undefined) delete process.env.GROK_DEFAULT_MODEL
    else process.env.GROK_DEFAULT_MODEL = previousDefault
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv points grok-build at SiSu via GROK_XAI_API_BASE_URL', () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  try {
    const env = sisuGrokBuildEnv()
    expect(env.GROK_XAI_API_BASE_URL).toBe('https://www.sisu.chat/api/runtime/v1')
    expect(env.GROK_XAI_API_BASE_URL).toContain('/api/runtime/v1')
    expect(env.GROK_XAI_API_BASE_URL).not.toContain('grok.com')
    expect(env.GROK_XAI_API_BASE_URL).not.toContain('api.x.ai')
    expect(env.GROK_MODELS_LIST_URL).toBe('https://www.sisu.chat/api/runtime/v1/models')
    expect(env.GROK_MODELS_BASE_URL).toBe('https://www.sisu.chat/api/runtime/v1')
    expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).not.toContain('grok.com')
    expect(env.GROK_TELEMETRY_ENABLED).toBe('0')
    const configPath = writeSisuGrokConfig()
    expect(configPath).toBe(path.join(home, 'engine', 'config.toml'))
    expect(fs.readFileSync(configPath, 'utf8')).toContain('xai_api_base_url = "https://www.sisu.chat/api/runtime/v1"')
    const bootPath = path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-pager-bin', 'src', 'sisu_boot.rs')
    if (fs.existsSync(bootPath)) {
      const boot = fs.readFileSync(bootPath, 'utf8')
      expect(boot).toMatch(/GROK_XAI_API_BASE_URL/)
      expect(boot).toMatch(/api\/runtime\/v1/)
    }
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('B-lite contract: no SISU_HOME on child, engine home, overwritten XAI_API_KEY', () => {
  const previous = {
    home: process.env.SISU_HOME,
    xai: process.env.XAI_API_KEY,
    grok: process.env.GROK_HOME,
    code: process.env.GROK_CODE_XAI_API_KEY,
    def: process.env.GROK_DEFAULT_MODEL,
  }
  process.env.XAI_API_KEY = 'sk-xai-from-shell'
  process.env.GROK_CODE_XAI_API_KEY = 'legacy'
  process.env.GROK_DEFAULT_MODEL = 'grok-4.6'
  const home = makeHome()
  try {
    const env = sisuGrokBuildEnv()
    expect(env.SISU_HOME).toBeUndefined()
    expect(env.SISU_ACCESS_POINT).toBe('1')
    expect(env.GROK_HOME).toBe(path.join(home, 'engine'))
    expect(env.GROK_AUTH_PATH).toBe(path.join(home, 'engine', 'auth.json'))
    expect(env.SISU_AUTH_PATH).toBe(path.join(home, 'auth.json'))
    expect(env.XAI_API_KEY).toBe('jwt')
    expect(env.XAI_API_KEY).not.toBe('sk-xai-from-shell')
    expect(env.GROK_CODE_XAI_API_KEY).toBeUndefined()
    expect(env.GROK_DEFAULT_MODEL).toBeUndefined()
    expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toBe('https://www.sisu.chat/api/runtime/v1')
    expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).not.toBe('')
    expect(env.GROK_MODELS_LIST_URL).toBe('https://www.sisu.chat/api/runtime/v1/models')
    expect(env.GROK_CHANGELOG_OFFLINE).toBe('1')
    expect(env.SISU_TOKEN).toBeUndefined()
    expect(fs.existsSync(path.join(home, 'auth.json'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).token).toBe('jwt')
  } finally {
    if (previous.home === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous.home
    if (previous.xai === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = previous.xai
    if (previous.grok === undefined) delete process.env.GROK_HOME
    else process.env.GROK_HOME = previous.grok
    if (previous.code === undefined) delete process.env.GROK_CODE_XAI_API_KEY
    else process.env.GROK_CODE_XAI_API_KEY = previous.code
    if (previous.def === undefined) delete process.env.GROK_DEFAULT_MODEL
    else process.env.GROK_DEFAULT_MODEL = previous.def
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('refuses spawn of an installed pager whose stamp is older than this package', () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  const dest = path.join(home, 'bin', 'xai-grok-pager')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, 'old')
  fs.writeFileSync(`${dest}.version`, '0.0.1\n')
  try {
    expect(pagerStampAllowsSpawn(dest)).toBe(false)
    expect(pagerStampAllowsSpawn(path.join(home, 'elsewhere', 'xai-grok-pager'))).toBe(true)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('B-full unsets XAI_API_KEY and sets SISU_TOKEN once pager stamp matches', () => {
  const previous = {
    home: process.env.SISU_HOME,
    xai: process.env.XAI_API_KEY,
    token: process.env.SISU_TOKEN,
    bfull: process.env.SISU_ACCESS_POINT_BFULL,
  }
  process.env.SISU_ACCESS_POINT_BFULL = '1'
  process.env.XAI_API_KEY = 'sk-xai-from-shell'
  const home = makeHome()
  try {
    const env = sisuGrokBuildEnv()
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.SISU_TOKEN).toBe('jwt')
    expect(env.GROK_CODE_XAI_API_KEY).toBeUndefined()
    expect(env.SISU_CONVERSATION_ID).toMatch(/^[0-9a-f-]{36}$/i)
    expect(env.SISU_ACCESS_POINT).toBe('1')
  } finally {
    if (previous.home === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous.home
    if (previous.xai === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = previous.xai
    if (previous.token === undefined) delete process.env.SISU_TOKEN
    else process.env.SISU_TOKEN = previous.token
    if (previous.bfull === undefined) delete process.env.SISU_ACCESS_POINT_BFULL
    else process.env.SISU_ACCESS_POINT_BFULL = previous.bfull
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('assertRuntimeAvailable throws RuntimeUnavailable on 404', async () => {
  const http = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
  await expect(assertRuntimeAvailable(http, 'https://www.sisu.chat')).rejects.toBeInstanceOf(RuntimeUnavailable)
})

it('assertRuntimeAvailable resolves on {ok:true}', async () => {
  const http = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, complete: true, models: true }),
  })
  await expect(assertRuntimeAvailable(http, 'https://www.sisu.chat')).resolves.toBeUndefined()
  expect(http).toHaveBeenCalledWith('https://www.sisu.chat/api/runtime/health', expect.anything())
})

it('migrateGrokScratchToEngine moves sessions and leaves SiSu auth.json', () => {
  const home = makeHome()
  fs.mkdirSync(path.join(home, 'sessions'))
  fs.writeFileSync(path.join(home, 'sessions', 'a.json'), '{}')
  fs.writeFileSync(path.join(home, 'CHANGELOG.md'), 'xai notes')
  try {
    migrateGrokScratchToEngine(home)
    purgeChangelogCache(home, path.join(home, 'engine'))
    expect(fs.existsSync(path.join(home, 'engine', 'sessions', 'a.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'sessions'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'CHANGELOG.md'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).token).toBe('jwt')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('migrateGrokScratchToEngine keeps colliding scratch instead of deleting it', () => {
  const home = makeHome()
  fs.mkdirSync(path.join(home, 'sessions'))
  fs.mkdirSync(path.join(home, 'engine', 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(home, 'sessions', 'keep-me.json'), '{"from":"old"}')
  fs.writeFileSync(path.join(home, 'engine', 'sessions', 'keep-me.json'), '{"from":"engine"}')
  fs.writeFileSync(path.join(home, 'sessions', 'only-old.json'), '{"from":"old-only"}')
  try {
    migrateGrokScratchToEngine(home)
    expect(JSON.parse(fs.readFileSync(path.join(home, 'engine', 'sessions', 'keep-me.json'), 'utf8'))).toEqual({
      from: 'engine',
    })
    expect(JSON.parse(fs.readFileSync(path.join(home, 'sessions', 'keep-me.json'), 'utf8'))).toEqual({
      from: 'old',
    })
    expect(fs.existsSync(path.join(home, 'engine', 'sessions', 'only-old.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'sessions', 'only-old.json'))).toBe(false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisu exec --stub completes a local-agent turn with a tool result twice', async () => {
  const previousHome = process.env.SISU_HOME
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-ws-'))
  fs.writeFileSync(path.join(cwd, 'hello.txt'), 'hello from workspace\n')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-home-'))
  process.env.SISU_HOME = home
  const previousCwd = process.cwd()
  process.chdir(cwd)
  const runs: string[] = []
  try {
    for (let i = 0; i < 2; i += 1) {
      const writes: string[] = []
      const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(String(chunk))
        return true
      })
      try {
        const code = await runCli(['exec', '--stub', '--new', 'read hello.txt'])
        expect(code).toBe(0)
        const out = writes.join('')
        expect(out).toMatch(/local tool result/)
        expect(out).toMatch(/hello from workspace/)
        runs.push(out)
      } finally {
        stdout.mockRestore()
      }
    }
    expect(runs).toHaveLength(2)
    expect(runs[0]).toBe(runs[1])
  } finally {
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('execCommand stub path changes a workspace file through the shipped loop', async () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  process.env.SISU_HOME = home
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-exec-'))
  fs.writeFileSync(path.join(cwd, 'hello.txt'), 'before\n')
  try {
    const result = await execCommand('edit', {
      stub: true,
      cwd,
      newConversation: true,
      modelClient: {
        async complete(request) {
          const hasTool = request.messages.some((row) => row.role === 'tool')
          if (!hasTool) {
            return {
              text: '',
              tool_calls: [
                {
                  id: 'e1',
                  name: 'search_replace',
                  arguments: { file_path: 'hello.txt', old_string: 'before', new_string: 'after' },
                },
              ],
            }
          }
          return { text: `edited:${request.messages.at(-1)?.content}`, tool_calls: [] }
        },
      },
    })
    expect(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8')).toBe('after\n')
    expect(result.text).toMatch(/edited:The file hello.txt has been updated/)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
