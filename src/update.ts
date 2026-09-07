import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { SISU_CLIENT_VERSION } from './client'
import { defaultHttp, type HttpClient } from './http'
import { comparePagerStamp } from './runtime/launch'
import { getSisuHome } from './store'

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
  if (latest && comparePagerStamp(latest, current) > 0) {
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

export async function fetchLatestVersion(http: HttpClient = defaultHttp): Promise<string> {
  const response = await http('https://registry.npmjs.org/@stevezhou/sisu/latest', {
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
    spawn?: typeof spawnSync
  } = {},
): void {
  const npm = options.npm || npmCliPath()
  const prefix = options.prefix === undefined ? npmGlobalPrefix() : options.prefix
  const args = ['install', '-g', `@stevezhou/sisu@${version}`]
  if (prefix) args.push('--prefix', prefix)
  const result = (options.spawn || spawnSync)(npm, args, { stdio: 'inherit' })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`npm install failed (${result.status ?? 'spawn'})`)
  }
}

export async function runUpdate(options: {
  currentVersion?: string
  fetchLatest: () => Promise<string>
  installPackage: (version: string) => Promise<void> | void
  installPager: (opts: { force?: boolean }) => Promise<PagerInstallResult>
  write: (text: string) => void
  writeErr?: (text: string) => void
}): Promise<number> {
  const current = options.currentVersion || SISU_CLIENT_VERSION
  const writeErr = options.writeErr || options.write
  let latest: string | null = null
  try {
    latest = await options.fetchLatest()
  } catch (error) {
    options.write(
      `sisu update: could not check npm (${error instanceof Error ? error.message : String(error)}); reinstalling pager\n`,
    )
  }
  const plan = planUpdate(current, latest)
  if (plan.action === 'upgrade') {
    options.write(`sisu: cli ${plan.from} -> ${plan.to}\n`)
    await options.installPackage(plan.to)
    options.write(`sisu: cli ${plan.to} installed (pager via postinstall). restart sisu.\n`)
    return 0
  }
  const result = await options.installPager({ force: true })
  if (result.ok) {
    options.write(
      result.skipped
        ? `pager already current${result.dest ? ` at ${result.dest}` : ''}\n`
        : `installed pager${result.dest ? ` to ${result.dest}` : ''}\n`,
    )
    return 0
  }
  writeErr(`sisu update: ${result.reason || 'pager install failed'}\n`)
  return result.skipped ? 0 : 1
}
