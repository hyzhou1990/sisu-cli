import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCli } from '../main'
import { readSession, writeAuth, writeSession } from '../store'
import { execCommand } from '../commands'
import { grokBuildPath } from './suite'
import {
  assertRuntimeAvailable,
  grokBuildBinaryCandidates,
  migrateGrokScratchToEngine,
  pagerBinaryName,
  prependToolPath,
  purgeChangelogCache,
  purgeXaiEngineAuth,
  RuntimeUnavailable,
  firstReadableDir,
  pagerBinaryRunnable,
  pagerProbeCwd,
  pagerSpawnCwd,
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

it('sisuGrokBuildEnv prepends to a "Path"-spelled PATH instead of replacing it', () => {
  // Windows spells the variable `Path`, and `{ ...process.env }` is a plain
  // object, so a bare `env.PATH` read misses. That used to replace PATH with
  // the private-Node dirs only, leaving the pager unable to resolve
  // powershell/sh/git: every run_terminal_command failed with
  // `Terminal error: IO Error: program not found`.
  const previousHome = process.env.SISU_HOME
  const previousPath = process.env.PATH
  const previousAltPath = process.env.Path
  const inherited = ['C:\\Windows\\System32', 'C:\\Program Files\\Git\\bin'].join(path.delimiter)
  const home = makeHome()
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  try {
    delete process.env.PATH
    process.env.Path = inherited
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    fs.mkdirSync(path.join(home, 'node'), { recursive: true })
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true })

    const env = sisuGrokBuildEnv()

    const pathKeys = Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')
    expect(pathKeys).toHaveLength(1)
    const value = String(env[pathKeys[0]])
    for (const dir of inherited.split(path.delimiter)) expect(value).toContain(dir)
    expect(value).toContain(path.join(home, 'node'))
    expect(value).toContain(path.join(home, 'bin'))
  } finally {
    if (descriptor) Object.defineProperty(process, 'platform', descriptor)
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    delete process.env.Path
    if (previousPath !== undefined) process.env.PATH = previousPath
    if (previousAltPath !== undefined) process.env.Path = previousAltPath
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv removes the shell xAI key whatever its casing', () => {
  const previousHome = process.env.SISU_HOME
  const previousLower = process.env.xai_api_key
  const home = makeHome()
  try {
    process.env.xai_api_key = 'sk-xai-from-shell'
    const env = sisuGrokBuildEnv()
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'XAI_API_KEY')).toHaveLength(1)
    expect(String(env.XAI_API_KEY || '')).not.toBe('sk-xai-from-shell')
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousLower === undefined) delete process.env.xai_api_key
    else process.env.xai_api_key = previousLower
    fs.rmSync(home, { recursive: true, force: true })
  }
})

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

it('sisuGrokBuildEnv opts into the harness updater only with a new-enough pager', () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  const pagerDir = path.join(home, 'bin')
  const stamp = (version: string) => {
    fs.mkdirSync(pagerDir, { recursive: true })
    fs.writeFileSync(path.join(pagerDir, 'xai-grok-pager.version'), `${version}\n`)
  }
  try {
    expect(sisuGrokBuildEnv().SISU_AUTO_UPDATE).toBeUndefined()
    stamp('0.3.37')
    expect(sisuGrokBuildEnv().SISU_AUTO_UPDATE).toBeUndefined()
    stamp('0.3.38')
    expect(sisuGrokBuildEnv().SISU_AUTO_UPDATE).toBe('1')
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
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
    expect(env.GROK_DISABLE_API_KEY_AUTH).toBeUndefined()
    const configPath = writeSisuGrokConfig()
    expect(configPath).toBe(path.join(home, 'engine', 'config.toml'))
    expect(fs.readFileSync(configPath, 'utf8')).toContain('xai_api_base_url = "https://www.sisu.chat/api/runtime/v1"')
    expect(fs.readFileSync(configPath, 'utf8')).toContain('system_prompt_label = "SiSu"')
    expect(env.GROK_SYSTEM_PROMPT_LABEL).toBe('SiSu')
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

it('purges xAI OAuth leftovers from engine auth.json', () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  const engine = path.join(home, 'engine')
  fs.mkdirSync(engine, { recursive: true })
  const file = path.join(engine, 'auth.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      'https://auth.x.ai::deadbeef': {
        auth_mode: 'oidc',
        key: 'xai-session',
        oidc_issuer: 'https://auth.x.ai',
        refresh_token: 'refresh',
      },
    }),
  )
  try {
    purgeXaiEngineAuth(engine)
    expect(fs.readFileSync(file, 'utf8').trim()).toBe('{}')
    fs.writeFileSync(
      file,
      JSON.stringify({
        'https://auth.x.ai::again': { auth_mode: 'oidc', key: 'xai-session' },
      }),
    )
    sisuGrokBuildEnv()
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/auth\.x\.ai/)
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
    const grokAuth = JSON.parse(String(env.GROK_AUTH || '{}')) as { key?: string; auth_mode?: string }
    expect(grokAuth.key).toBe('jwt')
    expect(grokAuth.auth_mode).toBe('api_key')
    expect(String(env.GROK_AUTH)).not.toMatch(/auth\.x\.ai|accounts\.x\.ai|grok\.com/)
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

it('puts the private Node bin ahead of PATH so the TUI can run npm', () => {
  const previousHome = process.env.SISU_HOME
  const previousPath = process.env.PATH
  const home = makeHome()
  const nodeBin = path.join(home, 'node', 'bin')
  fs.mkdirSync(nodeBin, { recursive: true })
  fs.writeFileSync(path.join(nodeBin, 'npm'), '#!/bin/sh\n')
  try {
    process.env.PATH = '/usr/bin:/bin'
    const env = sisuGrokBuildEnv()
    const parts = String(env.PATH || '').split(path.delimiter)
    expect(parts[0]).toBe(nodeBin)
    expect(prependToolPath('/usr/bin', home).startsWith(`${nodeBin}${path.delimiter}`)).toBe(true)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('names the Windows pager binary with an .exe suffix', () => {
  expect(pagerBinaryName('win32')).toBe('xai-grok-pager.exe')
  expect(pagerBinaryName('darwin')).toBe('xai-grok-pager')
  expect(pagerBinaryName('linux')).toBe('xai-grok-pager')
  const candidates = grokBuildBinaryCandidates()
  const expected = pagerBinaryName()
  expect(candidates.some((item) => item.endsWith(path.join('bin', expected)))).toBe(true)
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
    fs.writeFileSync(`${dest}.version`, '0.3.11\n')
    expect(pagerStampAllowsSpawn(dest)).toBe(true)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('picks the first readable directory and skips an unreadable preferred cwd', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-cwd-ok-'))
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-cwd-block-'))
  fs.chmodSync(blocked, 0)
  try {
    expect(firstReadableDir([blocked, home])).toBe(home)
    expect(pagerSpawnCwd(blocked, home)).toBe(home)
    expect(pagerProbeCwd(home)).toBe(home)
  } finally {
    fs.chmodSync(blocked, 0o700)
    fs.rmSync(blocked, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('treats GLIBC loader errors as an unrunnable pager', () => {
  const previousHome = process.env.SISU_HOME
  const spawn = jest.fn().mockReturnValue({
    status: 127,
    stdout: '',
    stderr:
      "/root/.sisu/bin/xai-grok-pager: /usr/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found (required by /root/.sisu/bin/xai-grok-pager)\n",
    error: undefined,
  })
  const home = makeHome()
  const dest = path.join(home, 'bin', 'xai-grok-pager')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, 'elf')
  try {
    expect(pagerBinaryRunnable(dest, spawn as never)).toBe(false)
    expect(spawn).toHaveBeenCalledWith(
      dest,
      ['--help'],
      expect.objectContaining({ encoding: 'utf8', cwd: pagerProbeCwd() }),
    )
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('treats a pager that starts as runnable', () => {
  const previousHome = process.env.SISU_HOME
  const spawn = jest.fn().mockReturnValue({ status: 0, stdout: 'usage', stderr: '', error: undefined })
  const home = makeHome()
  const dest = path.join(home, 'bin', 'xai-grok-pager')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, 'elf')
  try {
    expect(pagerBinaryRunnable(dest, spawn as never)).toBe(true)
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
    expect(JSON.parse(String(env.GROK_AUTH)).auth_mode).toBe('api_key')
    expect(JSON.parse(String(env.GROK_AUTH)).key).toBe('jwt')
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
