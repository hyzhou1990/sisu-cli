import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
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

export function pagerBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'xai-grok-pager.exe' : 'xai-grok-pager'
}

export function grokBuildBinaryCandidates(): string[] {
  const env = (process.env.SISU_GROK_BIN || '').trim()
  const root = grokBuildRoot()
  const name = pagerBinaryName()
  const packaged = path.resolve(__dirname, '..', 'bin', name)
  const npmInstalled = path.join(getSisuHome(), 'bin', name)
  return [
    env,
    npmInstalled,
    packaged,
    path.join(root, 'target', 'release', name),
    path.join(root, 'target', 'debug', name),
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
  return path.join(getSisuHome(), 'bin', pagerBinaryName())
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

const PAGER_LOADER_FAIL =
  /GLIBC_\d|not found \(required by|Exec format error|cannot execute binary file|error while loading shared libraries/i

/** First candidate `accessSync` can read. macOS TCC often blocks Desktop; never inherit that. */
export function firstReadableDir(candidates: Array<string | undefined | null>): string {
  for (const dir of candidates) {
    if (!dir) continue
    try {
      fs.accessSync(dir, fs.constants.R_OK)
      return dir
    } catch {
      continue
    }
  }
  return os.tmpdir()
}

/** grok-pager workspace: prefer the caller's cwd when it is readable. */
export function pagerSpawnCwd(preferred = process.cwd(), home = getSisuHome()): string {
  return firstReadableDir([preferred, home, os.homedir(), os.tmpdir()])
}

/** Probe must not inherit a TCC-blocked cwd or the binary never even execs. */
export function pagerProbeCwd(home = getSisuHome()): string {
  return firstReadableDir([home, os.homedir(), os.tmpdir()])
}

/** Dynamic linker / glibc mismatches fail before main(). Probe without inheriting the TTY. */
export function pagerBinaryRunnable(
  binary: string,
  spawn: typeof spawnSync = spawnSync,
): boolean {
  if (!binary || !fs.existsSync(binary)) return false
  const result = spawn(binary, ['--help'], {
    encoding: 'utf8',
    timeout: 2500,
    env: { ...process.env, TERM: 'dumb' },
    cwd: pagerProbeCwd(),
  })
  const blob = `${result.stderr || ''}\n${result.stdout || ''}\n${result.error?.message || ''}`
  if (PAGER_LOADER_FAIL.test(blob)) return false
  const err = result.error as NodeJS.ErrnoException | undefined
  if (err && (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM')) return false
  if ((result.status ?? 0) === 127) return false
  return true
}

/** Windows environment names are case-insensitive, but `{ ...process.env }` is a
 *  plain object keyed by the inherited spelling (`Path`). A bare `env.PATH`
 *  read, write, or delete therefore misses: on Windows the read returned
 *  undefined, so PATH was replaced by the private-Node dirs instead of being
 *  prepended to, and every child process lost System32 — the pager could no
 *  longer resolve powershell/sh/git and every terminal command failed with
 *  `program not found`.
 */
function envKeyOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const upper = name.toUpperCase()
  return Object.keys(env).find((key) => key.toUpperCase() === upper)
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  const key = envKeyOf(env, name)
  return (key && env[key]) || ''
}

/** Deletes `name` whatever its casing, so a child cannot inherit it. */
function deleteEnv(env: NodeJS.ProcessEnv, name: string): void {
  const key = envKeyOf(env, name)
  if (key) delete env[key]
}

/** Writes `name` under the spelling already present and drops other-cased
 *  duplicates, so Windows cannot hand a child the shorter of two values.
 */
function setEnv(env: NodeJS.ProcessEnv, name: string, value: string): void {
  const upper = name.toUpperCase()
  const key = envKeyOf(env, name) || name
  for (const other of Object.keys(env)) {
    if (other !== key && other.toUpperCase() === upper) delete env[other]
  }
  env[key] = value
}

export function prependToolPath(pathEnv = process.env.PATH || '', home = getSisuHome()): string {
  const extra =
    process.platform === 'win32'
      ? [path.join(home, 'node'), path.join(home, 'bin')]
      : [
          path.join(home, 'node', 'bin'),
          path.join(home, 'bin'),
          path.join(os.homedir(), '.local', 'bin'),
          '/opt/homebrew/bin',
        ]
  const delim = path.delimiter
  const current = pathEnv.split(delim).filter(Boolean)
  const seen = new Set(current.map((dir) => (process.platform === 'win32' ? dir.toLowerCase() : dir)))
  const prefix: string[] = []
  for (const dir of extra) {
    if (!dir || !fs.existsSync(dir)) continue
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) continue
    seen.add(key)
    prefix.push(dir)
  }
  return [...prefix, ...current].join(delim)
}

export function sisuGrokBuildEnv(): NodeJS.ProcessEnv {
  const auth = readAuth()
  const engine = sisuEngineHome()
  const apiBase = auth?.api_base || process.env.SISU_API_BASE || DEFAULT_API_BASE
  const runtime = sisuRuntimeApiBase(apiBase)
  const env = { ...process.env }
  deleteEnv(env, 'SISU_HOME')
  deleteEnv(env, 'GROK_CODE_XAI_API_KEY')
  deleteEnv(env, 'GROK_DEFAULT_MODEL')
  deleteEnv(env, 'SISU_TOKEN')
  // Must not set GROK_DISABLE_API_KEY_AUTH: AuthManager.vet_cached hides
  // auth_mode=api_key snapshots, so the pager thinks there is no session
  // and exits 10 (host login) in a loop.
  deleteEnv(env, 'GROK_DISABLE_API_KEY_AUTH')
  if (accessPointBfullEnabled()) {
    deleteEnv(env, 'XAI_API_KEY')
    setEnv(env, 'SISU_TOKEN', auth?.token || '')
  } else {
    setEnv(env, 'XAI_API_KEY', auth?.token || '')
  }
  // grok-build's cached_token path reads GROK_AUTH / GROK_HOME auth.json.
  // Without a disk session it falls through to accounts.x.ai. Seed an ApiKey
  // snapshot of the SiSu JWT so the pager never starts grok.com OAuth.
  deleteEnv(env, 'GROK_AUTH')
  if (auth?.token) {
    setEnv(
      env,
      'GROK_AUTH',
      JSON.stringify({
        key: auth.token,
        auth_mode: 'api_key',
        create_time: new Date().toISOString(),
        user_id: auth.user_id || 'sisu',
        email: auth.email || undefined,
      }),
    )
  }
  purgeXaiEngineAuth(engine)
  setEnv(env, 'PATH', prependToolPath(readEnv(env, 'PATH'), getSisuHome()))
  setEnv(env, 'SISU_ACCESS_POINT', '1')
  setEnv(env, 'GROK_HOME', engine)
  setEnv(env, 'GROK_AUTH_PATH', path.join(engine, 'auth.json'))
  setEnv(env, 'SISU_AUTH_PATH', sisuAuthPath())
  setEnv(env, 'SISU_ACCOUNT_EMAIL', auth?.email || '')
  setEnv(env, 'SISU_ACCOUNT_PLAN', auth?.plan_code || '')
  setEnv(env, 'SISU_API_BASE', apiBase)
  setEnv(env, 'SISU_CLIENT_VERSION', SISU_CLIENT_VERSION)
  setEnv(env, 'GROK_SYSTEM_PROMPT_LABEL', 'SiSu')
  setEnv(env, 'SISU_CONVERSATION_ID', ensureConversationId())
  setEnv(env, 'GROK_XAI_API_BASE_URL', runtime)
  setEnv(env, 'XAI_API_BASE_URL', runtime)
  setEnv(env, 'GROK_MODELS_BASE_URL', runtime)
  setEnv(env, 'GROK_MODELS_LIST_URL', `${runtime}/models`)
  setEnv(env, 'GROK_CLI_CHAT_PROXY_BASE_URL', runtime)
  setEnv(env, 'GROK_DISABLE_CLI_CHAT_PROXY', '1')
  setEnv(env, 'GROK_TELEMETRY_ENABLED', '0')
  setEnv(env, 'GROK_CHANGELOG_OFFLINE', '1')
  return env
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
