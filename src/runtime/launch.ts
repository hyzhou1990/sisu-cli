import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { SISU_CLIENT_VERSION } from '../client'
import { DEFAULT_API_BASE, ensureConversationId, readAuth, getSisuHome, sisuAuthPath, sisuEngineHome } from '../store'
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

/** Drop leftover grok.com / auth.x.ai sessions from the pager engine store. */
export function purgeXaiEngineAuth(engine = sisuEngineHome()): string {
  const file = path.join(engine, 'auth.json')
  if (!fs.existsSync(file)) return file
  try {
    const raw = fs.readFileSync(file, 'utf8')
    if (!/auth\.x\.ai|accounts\.x\.ai|grok\.com/i.test(raw)) return file
    fs.writeFileSync(file, '{}\n', { encoding: 'utf8', mode: 0o600 })
  } catch {
    // missing / busy — next launch retries
  }
  return file
}

export function writeSisuGrokConfig(): string {
  const auth = readAuth()
  const engine = sisuEngineHome()
  fs.mkdirSync(engine, { recursive: true, mode: 0o700 })
  purgeXaiEngineAuth(engine)
  const file = path.join(engine, 'config.toml')
  const runtimeBase = sisuRuntimeApiBase(auth?.api_base || process.env.SISU_API_BASE || DEFAULT_API_BASE)
  const body = [
    '# sisu-managed grok-build config — SiSu auth + models + quota',
    '[endpoints]',
    `xai_api_base_url = "${runtimeBase}"`,
    '',
    '[agent]',
    'system_prompt_label = "SiSu"',
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
      for (const entry of fs.readdirSync(from)) {
        const src = path.join(from, entry)
        const dest = path.join(to, entry)
        if (!fs.existsSync(dest)) fs.renameSync(src, dest)
      }
      // Keep leftover colliding entries. Never rm -rf a tree we skipped.
      if (fs.readdirSync(from).length === 0) fs.rmdirSync(from)
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

export function installedPagerPath(): string {
  return path.join(getSisuHome(), 'bin', process.platform === 'win32' ? 'xai-grok-pager.exe' : 'xai-grok-pager')
}

export function pagerStampPath(dest = installedPagerPath()): string {
  return `${dest}.version`
}

export function installedPagerStamp(dest = installedPagerPath()): string {
  try {
    return fs.readFileSync(pagerStampPath(dest), 'utf8').trim()
  } catch {
    return ''
  }
}

export function comparePagerStamp(stamped: string, release: string): number {
  const parse = (value: string) => value.trim().split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(stamped)
  const right = parse(release)
  const n = Math.max(left.length, right.length)
  for (let i = 0; i < n; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

export function pagerStampMeetsRelease(
  stamped = installedPagerStamp(),
  release = SISU_CLIENT_VERSION,
): boolean {
  if (!stamped || !release) return false
  return comparePagerStamp(stamped, release) >= 0
}

/** First pager that speaks the access-point contract. Host patches may ship ahead of a rebuild. */
export const MIN_PAGER_STAMP = '0.3.11'

/** B-full when the host env flag is on or the installed pager is at least MIN_PAGER_STAMP. */
export function accessPointBfullEnabled(): boolean {
  return process.env.SISU_ACCESS_POINT_BFULL === '1' || pagerStampMeetsRelease(installedPagerStamp(), MIN_PAGER_STAMP)
}

/** Installed ~/.sisu/bin pager must be the access-point contract; other paths (SISU_GROK_BIN / cargo) are dev. */
export function pagerStampAllowsSpawn(binary: string): boolean {
  if (path.resolve(binary) !== path.resolve(installedPagerPath())) return true
  return pagerStampMeetsRelease(installedPagerStamp(binary), MIN_PAGER_STAMP)
}

export function sisuGrokBuildEnv(): NodeJS.ProcessEnv {
  const auth = readAuth()
  const engine = sisuEngineHome()
  const apiBase = auth?.api_base || process.env.SISU_API_BASE || DEFAULT_API_BASE
  const runtime = sisuRuntimeApiBase(apiBase)
  const env = { ...process.env }
  delete env.SISU_HOME
  delete env.GROK_CODE_XAI_API_KEY
  delete env.GROK_DEFAULT_MODEL
  delete env.SISU_TOKEN
  // Must not set GROK_DISABLE_API_KEY_AUTH: AuthManager.vet_cached hides
  // auth_mode=api_key snapshots, so the pager thinks there is no session
  // and exits 10 (host login) in a loop.
  delete env.GROK_DISABLE_API_KEY_AUTH
  if (accessPointBfullEnabled()) {
    delete env.XAI_API_KEY
    env.SISU_TOKEN = auth?.token || ''
  } else {
    env.XAI_API_KEY = auth?.token || ''
  }
  // grok-build's cached_token path reads GROK_AUTH / GROK_HOME auth.json.
  // Without a disk session it falls through to accounts.x.ai. Seed an ApiKey
  // snapshot of the SiSu JWT so the pager never starts grok.com OAuth.
  delete env.GROK_AUTH
  if (auth?.token) {
    env.GROK_AUTH = JSON.stringify({
      key: auth.token,
      auth_mode: 'api_key',
      create_time: new Date().toISOString(),
      user_id: auth.user_id || 'sisu',
      email: auth.email || undefined,
    })
  }
  purgeXaiEngineAuth(engine)
  return {
    ...env,
    SISU_ACCESS_POINT: '1',
    GROK_HOME: engine,
    GROK_AUTH_PATH: path.join(engine, 'auth.json'),
    SISU_AUTH_PATH: sisuAuthPath(),
    SISU_ACCOUNT_EMAIL: auth?.email || '',
    SISU_ACCOUNT_PLAN: auth?.plan_code || '',
    SISU_API_BASE: apiBase,
    SISU_CLIENT_VERSION,
    GROK_SYSTEM_PROMPT_LABEL: 'SiSu',
    SISU_CONVERSATION_ID: ensureConversationId(),
    GROK_XAI_API_BASE_URL: runtime,
    XAI_API_BASE_URL: runtime,
    GROK_MODELS_BASE_URL: runtime,
    GROK_MODELS_LIST_URL: `${runtime}/models`,
    GROK_CLI_CHAT_PROXY_BASE_URL: runtime,
    GROK_DISABLE_CLI_CHAT_PROXY: '1',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_CHANGELOG_OFFLINE: '1',
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
