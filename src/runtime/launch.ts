import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { DEFAULT_API_BASE, readAuth, getSisuHome, sisuAuthPath, sisuEngineHome } from '../store'
import type { HttpClient } from '../http'
import { grokBuildRoot } from './suite'
import { openaiCompatUrl } from './adapter'

const SCRATCH_DIRS = ['sessions', 'worktrees', 'hooks', 'logs'] as const

export class RuntimeUnavailable extends Error {
  constructor(message = 'SiSu runtime is not available') {
    super(message)
    this.name = 'RuntimeUnavailable'
  }
}

export async function assertRuntimeAvailable(
  http: HttpClient,
  apiBase: string,
): Promise<void> {
  const url = `${apiBase.replace(/\/+$/, '')}/api/runtime/health`
  let response: { ok: boolean; status: number; json: () => Promise<unknown> }
  try {
    response = await http(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new RuntimeUnavailable(error instanceof Error ? error.message : String(error))
  }
  if (!response || !response.ok) {
    throw new RuntimeUnavailable(`health ${response?.status ?? 'unreachable'}`)
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean } | null
  if (!body || body.ok !== true) throw new RuntimeUnavailable('health body missing ok')
}

export function grokBuildBinaryCandidates(): string[] {
  const env = (process.env.SISU_GROK_BIN || '').trim()
  const root = grokBuildRoot()
  const packaged = path.resolve(__dirname, '..', 'bin', 'xai-grok-pager')
  const npmInstalled = path.join(getSisuHome(), 'bin', process.platform === 'win32' ? 'xai-grok-pager.exe' : 'xai-grok-pager')
  return [
    env,
    npmInstalled,
    packaged,
    path.join(root, 'target', 'release', 'xai-grok-pager'),
    path.join(root, 'target', 'debug', 'xai-grok-pager'),
    path.join(root, 'target', 'release', 'sisu-agent'),
  ].filter(Boolean)
}

export function findGrokBuildBinary(): string | null {
  for (const candidate of grokBuildBinaryCandidates()) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

export function sisuRuntimeApiBase(apiBase: string): string {
  return openaiCompatUrl(apiBase).replace(/\/chat\/completions$/, '')
}

export function writeSisuGrokConfig(): string {
  const auth = readAuth()
  const engine = sisuEngineHome()
  fs.mkdirSync(engine, { recursive: true, mode: 0o700 })
  const file = path.join(engine, 'config.toml')
  const runtimeBase = sisuRuntimeApiBase(auth?.api_base || process.env.SISU_API_BASE || DEFAULT_API_BASE)
  const body = [
    '# sisu-managed grok-build config — SiSu auth + models + quota',
    '[endpoints]',
    `xai_api_base_url = "${runtimeBase}"`,
    '',
  ].join('\n')
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!existing || existing.includes('sisu-managed grok-build')) {
    fs.writeFileSync(file, `${body}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  return file
}

export function migrateGrokScratchToEngine(home: string): void {
  const engine = path.join(home, 'engine')
  fs.mkdirSync(engine, { recursive: true, mode: 0o700 })
  for (const name of SCRATCH_DIRS) {
    const from = path.join(home, name)
    const to = path.join(engine, name)
    if (!fs.existsSync(from)) continue
    if (fs.existsSync(to)) {
      // Merge files into existing engine dir, then remove the top-level scratch.
      for (const entry of fs.readdirSync(from)) {
        const src = path.join(from, entry)
        const dest = path.join(to, entry)
        if (!fs.existsSync(dest)) fs.renameSync(src, dest)
      }
      fs.rmSync(from, { recursive: true, force: true })
    } else {
      fs.renameSync(from, to)
    }
  }
}

export function purgeChangelogCache(home: string, engine: string): void {
  for (const root of [home, engine]) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('CHANGELOG')) continue
      try {
        fs.unlinkSync(path.join(root, entry))
      } catch {
        // ignore missing / busy
      }
    }
  }
}

export function sisuGrokBuildEnv(): NodeJS.ProcessEnv {
  const auth = readAuth()
  const home = getSisuHome()
  const engine = sisuEngineHome()
  const apiBase = auth?.api_base || process.env.SISU_API_BASE || DEFAULT_API_BASE
  const runtime = sisuRuntimeApiBase(apiBase)
  const env = { ...process.env }
  delete env.SISU_HOME
  delete env.GROK_CODE_XAI_API_KEY
  delete env.GROK_DEFAULT_MODEL
  // B-lite: overwrite shell key. B-full: delete env.XAI_API_KEY instead.
  env.XAI_API_KEY = auth?.token || ''
  return {
    ...env,
    SISU_ACCESS_POINT: '1',
    GROK_HOME: engine,
    GROK_AUTH_PATH: path.join(engine, 'auth.json'),
    SISU_AUTH_PATH: sisuAuthPath(),
    SISU_ACCOUNT_EMAIL: auth?.email || '',
    SISU_ACCOUNT_PLAN: auth?.plan_code || '',
    SISU_API_BASE: apiBase,
    GROK_XAI_API_BASE_URL: runtime,
    XAI_API_BASE_URL: runtime,
    GROK_MODELS_BASE_URL: runtime,
    GROK_MODELS_LIST_URL: `${runtime}/models`,
    GROK_CLI_CHAT_PROXY_BASE_URL: runtime,
    GROK_DISABLE_CLI_CHAT_PROXY: '1',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_CHANGELOG_OFFLINE: '1',
    GROK_DISABLE_API_KEY_AUTH: '1',
  }
}

export function launchGrokBuildHeadless(prompt: string, cwd: string): { status: number; stdout: string; stderr: string; binary: string | null } {
  const binary = findGrokBuildBinary()
  if (!binary) {
    return { status: 127, stdout: '', stderr: 'grok-build binary not built', binary: null }
  }
  const result = spawnSync(binary, ['-p', prompt], {
    cwd,
    encoding: 'utf8',
    env: sisuGrokBuildEnv(),
    timeout: 30_000,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
    binary,
  }
}
