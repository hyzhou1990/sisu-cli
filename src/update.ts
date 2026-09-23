import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SISU_CLIENT_VERSION } from './client'
import { defaultHttp, type HttpClient } from './http'
import { comparePagerStamp, firstReadableDir } from './runtime/launch'
import { getSisuHome } from './store'
import { type InstallSource, driftedSources, findInstallSources, formatDriftWarning } from './updateSources'

export type PagerInstallResult = {
  ok: boolean
  dest?: string
  skipped?: boolean
  reason?: string
}

export type UpdatePlan =
  | { action: 'upgrade'; from: string; to: string }
  | { action: 'pager'; version: string }

export function planUpdate(current: string, latest: string | null): UpdatePlan {
  if (!latest) return { action: 'upgrade', from: current, to: 'latest' }
  if (comparePagerStamp(latest, current) > 0) {
    return { action: 'upgrade', from: current, to: latest }
  }
  return { action: 'pager', version: current }
}

export function npmGlobalPrefix(packageRoot = path.join(__dirname, '..')): string {
  const resolved = path.resolve(packageRoot)
  const needle = `${path.sep}node_modules${path.sep}`
  const idx = resolved.lastIndexOf(needle)
  if (idx <= 0) return ''
  const before = resolved.slice(0, idx)
  if (path.basename(before) === 'lib') return path.dirname(before)
  return before
}

export function npmCliPath(home = getSisuHome()): string {
  const unix = path.join(home, 'node', 'bin', 'npm')
  const win = path.join(home, 'node', 'npm.cmd')
  if (fs.existsSync(unix)) return unix
  if (fs.existsSync(win)) return win
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** First `name` on PATH, using Windows path rules regardless of the host that
 *  runs this (CI is Linux). `process.env` resolves `PATH` case-insensitively,
 *  but the variable can be absent, so try both spellings.
 */
function resolveOnWindowsPath(
  name: string,
  options: { pathEnv?: string; exists?: (file: string) => boolean } = {},
): string | null {
  const pathEnv = options.pathEnv ?? process.env.PATH ?? process.env.Path ?? ''
  const exists = options.exists || ((file: string) => fs.existsSync(file))
  for (const dir of pathEnv.split(';')) {
    if (!dir) continue
    const candidate = path.win32.join(dir, name)
    if (exists(candidate)) return candidate
  }
  return null
}

/** What to actually execute for `npm install`, as `(file, args)`.
 *
 *  Windows ships npm as a batch shim, and Node refuses to spawn `.cmd`/`.bat`
 *  without a shell (the CVE-2024-27980 fix, Node 18.20.2 / 20.12.2 / 21.7.3),
 *  so `spawnSync('npm.cmd', …)` fails with EINVAL and `sisu update` never
 *  runs. The shim only starts `<dir>\node_modules\npm\bin\npm-cli.js` with the
 *  sibling `node.exe`, so run that entry point directly instead: no shell, no
 *  batch re-parsing, and argv reaches npm unmangled — a `--prefix` containing
 *  a space still arrives as one argument.
 */
export function npmInvocation(
  npm: string,
  args: string[],
  options: { platform?: NodeJS.Platform; pathEnv?: string; exists?: (file: string) => boolean } = {},
): { file: string; args: string[] } {
  const platform = options.platform || process.platform
  if (platform !== 'win32') return { file: npm, args }
  if (!/\.(cmd|bat)$/i.test(npm)) return { file: npm, args }
  const exists = options.exists || ((file: string) => fs.existsSync(file))
  // `path.win32` on purpose: these are Windows paths, and the host running this
  // may not be Windows (CI is Linux), where `path` would split them wrongly.
  const win = path.win32
  const shim = win.isAbsolute(npm) ? npm : resolveOnWindowsPath(npm, options)
  if (!shim) return { file: npm, args }
  const dir = win.dirname(shim)
  const node = win.join(dir, 'node.exe')
  const cli = win.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (exists(node) && exists(cli)) return { file: node, args: [cli, ...args] }
  return { file: npm, args }
}

/** npm calls process.cwd() at startup. macOS TCC often blocks Desktop, so never inherit it. */
export function npmInstallCwd(home = getSisuHome()): string {
  return firstReadableDir([home, os.homedir(), os.tmpdir()])
}

export function npmLatestUrl(): string {
  const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/+$/, '')
  return `${registry}/@stevezhou/sisu/latest`
}

export function formatUpdateNotice(current: string, latest: string): string | null {
  if (comparePagerStamp(latest, current) <= 0) return null
  return `sisu: ${current} → ${latest} available. Run sisu update.\n`
}

export async function fetchLatestVersion(http: HttpClient = defaultHttp): Promise<string> {
  const response = await http(npmLatestUrl(), {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`npm registry ${response.status}`)
  const body = (await response.json()) as { version?: string }
  const version = String(body.version || '').trim()
  if (!version) throw new Error('npm registry missing version')
  return version
}

export function installNpmPackage(
  version: string,
  options: {
    npm?: string
    prefix?: string
    cwd?: string
    spawn?: typeof spawnSync
  } = {},
): void {
  const npm = options.npm || npmCliPath()
  const prefix = options.prefix === undefined ? npmGlobalPrefix() : options.prefix
  const args = ['install', '-g', `@stevezhou/sisu@${version}`]
  if (prefix) args.push('--prefix', prefix)
  const invocation = npmInvocation(npm, args)
  const result = (options.spawn || spawnSync)(invocation.file, invocation.args, {
    stdio: 'inherit',
    cwd: options.cwd || npmInstallCwd(),
  })
  if ((result.status ?? 1) !== 0) {
    // EINVAL/ENOENT here reaches the user as a bare "spawn", which says nothing
    // about what to fix. Surface the errno.
    const err = result.error as NodeJS.ErrnoException | undefined
    const detail = err ? ` ${err.code || err.message}` : ''
    throw new Error(`npm install failed (${result.status ?? 'spawn'}${detail})`)
  }
}

const UPDATE_CHECK_MS = 1500
const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

function updateCachePath(home = getSisuHome()): string {
  return path.join(home, 'update-check.json')
}

export function readCachedLatest(
  now = Date.now(),
  home = getSisuHome(),
): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(updateCachePath(home), 'utf8')) as {
      latest?: string
      at?: number
    }
    if (!raw.latest || typeof raw.at !== 'number') return null
    if (now - raw.at > UPDATE_CACHE_TTL_MS) return null
    return raw.latest
  } catch {
    return null
  }
}

export function writeCachedLatest(latest: string, now = Date.now(), home = getSisuHome()): void {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    fs.writeFileSync(
      updateCachePath(home),
      `${JSON.stringify({ latest, at: now })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch {
    // cache is optional
  }
}

export async function maybeLatestUpdate(
  options: {
    current?: string
    fetchLatest?: () => Promise<string>
    now?: number
    home?: string
    timeoutMs?: number
    skip?: boolean
  } = {},
): Promise<string | null> {
  if (options.skip || process.env.SISU_SKIP_UPDATE_CHECK === '1') return null
  const current = options.current || SISU_CLIENT_VERSION
  const home = options.home || getSisuHome()
  const cached = readCachedLatest(options.now, home)
  if (cached) return formatUpdateNotice(current, cached) ? cached : null
  const fetchLatest = options.fetchLatest
  if (!fetchLatest) return null
  const timeoutMs = options.timeoutMs ?? UPDATE_CHECK_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const latest = await Promise.race([
      fetchLatest(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
    writeCachedLatest(latest, options.now, home)
    return formatUpdateNotice(current, latest) ? latest : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function runUpdate(options: {
  currentVersion?: string
  fetchLatest: () => Promise<string>
  installPackage: (version: string) => Promise<void> | void
  installPager: (opts: { force?: boolean }) => Promise<PagerInstallResult>
  write: (text: string) => void
  writeErr?: (text: string) => void
  /** Sibling-install drift check; injected in tests. */
  checkDrift?: (targetVersion: string) => InstallSource[]
}): Promise<number> {
  const current = options.currentVersion || SISU_CLIENT_VERSION
  const writeErr = options.writeErr || options.write
  const warnDrift = (targetVersion: string): void => {
    const check = options.checkDrift
    if (!check || targetVersion === 'latest') return
    for (const source of driftedSources(targetVersion, check(targetVersion))) {
      writeErr(formatDriftWarning(source, targetVersion))
    }
  }
  options.write(`sisu: cli ${current}\n`)
  let latest: string | null = null
  try {
    latest = await options.fetchLatest()
    options.write(`sisu: npm latest ${latest}\n`)
  } catch (error) {
    options.write(
      `sisu: could not check npm (${error instanceof Error ? error.message : String(error)}); installing @latest\n`,
    )
  }
  const plan = planUpdate(current, latest)
  if (plan.action === 'upgrade') {
    options.write(`sisu: cli ${plan.from} -> ${plan.to}\n`)
    try {
      await options.installPackage(plan.to)
    } catch (error) {
      writeErr(`sisu update: ${error instanceof Error ? error.message : String(error)}\n`)
      // `cd ~` is not a Windows path, and on Windows the reliable repair is the
      // site installer (it also restores the private Node and the PATH entry).
      writeErr(
        process.platform === 'win32'
          ? 'sisu update: re-run the installer from https://www.sisu.chat/cli, or: npm install -g @stevezhou/sisu\n'
          : 'sisu update: run `cd ~ && npm install -g @stevezhou/sisu` then `sisu --version`\n',
      )
      return 1
    }
    options.write(`sisu: cli ${plan.to} installed (pager via postinstall). restart sisu.\n`)
    warnDrift(plan.to)
    return 0
  }
  options.write(`sisu: cli already ${current}\n`)
  const result = await options.installPager({ force: true })
  if (result.ok) {
    options.write(
      result.skipped
        ? `pager already current${result.dest ? ` at ${result.dest}` : ''}\n`
        : `installed pager${result.dest ? ` to ${result.dest}` : ''}\n`,
    )
    warnDrift(current)
    return 0
  }
  writeErr(`sisu update: ${result.reason || 'pager install failed'}\n`)
  warnDrift(current)
  return result.skipped ? 0 : 1
}
