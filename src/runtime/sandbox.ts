import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

/**
 * Opt-in CLI sandbox. The engine already ships kernel-enforced profiles
 * (Seatbelt on macOS, Landlock + bubblewrap on Linux) and auto-approves bash
 * while a profile is active. The host only adds a SiSu profile that extends
 * `workspace` (write: project dir, engine home, temp) and kernel-denies common
 * credential stores, then passes `--sandbox sisu` to the pager.
 */
export const SISU_SANDBOX_PROFILE = 'sisu'
const MANAGED_MARKER = '# sisu-managed sandbox profile'

export function sandboxDenyPaths(home = os.homedir()): string[] {
  return [
    ...['.ssh', '.aws', '.gnupg', '.kube', '.azure', '.config/gh', '.config/gcloud', '.docker/config.json', '.netrc'].map(
      (rel) => path.join(home, rel),
    ),
    '**/.env',
    '**/.env.local',
    '**/.env.production',
    '**/*.pem',
    '**/*.key',
  ]
}

/** Linux read-deny needs bubblewrap; without it the engine refuses to start a deny profile. */
export function bubblewrapAvailable(run: typeof spawnSync = spawnSync): boolean {
  const result = run('bwrap', ['--version'], { encoding: 'utf8', timeout: 2000 })
  return !result.error && result.status === 0
}

export function canKernelDeny(platform: NodeJS.Platform = process.platform, hasBwrap = bubblewrapAvailable): boolean {
  if (platform === 'darwin') return true
  if (platform === 'linux') return hasBwrap()
  return false
}

export function sisuSandboxProfileToml(deny: string[]): string {
  const lines = [MANAGED_MARKER, `[profiles.${SISU_SANDBOX_PROFILE}]`, 'extends = "workspace"']
  if (deny.length) lines.push(`deny = [${deny.map((item) => JSON.stringify(item)).join(', ')}]`)
  return `${lines.join('\n')}\n`
}

/** Writes engine/sandbox.toml unless the user owns it. Returns whether the deny list is active. */
export function writeSisuSandboxProfile(
  engine: string,
  options: { home?: string; platform?: NodeJS.Platform; hasBwrap?: () => boolean } = {},
): { file: string; written: boolean; denyActive: boolean } {
  const file = path.join(engine, 'sandbox.toml')
  const denyActive = canKernelDeny(options.platform, options.hasBwrap)
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (existing && !existing.startsWith(MANAGED_MARKER)) return { file, written: false, denyActive }
  fs.mkdirSync(engine, { recursive: true, mode: 0o700 })
  const body = sisuSandboxProfileToml(denyActive ? sandboxDenyPaths(options.home) : [])
  if (existing !== body) fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 })
  return { file, written: true, denyActive }
}

/** Persisted opt-in: `sisu sandbox on|off` writes $SISU_HOME/sandbox.json. */
export function sandboxSettingPath(home: string): string {
  return path.join(home, 'sandbox.json')
}

export function readSandboxSetting(home: string): boolean {
  try {
    return JSON.parse(fs.readFileSync(sandboxSettingPath(home), 'utf8')).enabled === true
  } catch {
    return false
  }
}

export function writeSandboxSetting(home: string, enabled: boolean): void {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  fs.writeFileSync(sandboxSettingPath(home), `${JSON.stringify({ enabled })}\n`, { encoding: 'utf8', mode: 0o600 })
}

/**
 * Split `--sandbox [profile]` out of the TUI argv.
 * - `--sandbox` alone, `--sandbox on` or `--sandbox sisu` → the SiSu profile
 * - `--sandbox off` → explicitly off (overrides the persisted setting)
 * - any other value → passed through (engine built-ins / user profiles)
 * Without the flag, the persisted setting (or SISU_SANDBOX=1) decides.
 */
export function resolveSandbox(
  argv: string[],
  persisted: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { argv: string[]; profile: string | null } {
  const index = argv.indexOf('--sandbox')
  if (index === -1) {
    const on = persisted || env.SISU_SANDBOX === '1'
    return { argv, profile: on ? SISU_SANDBOX_PROFILE : null }
  }
  const value = argv[index + 1]
  const hasValue = value !== undefined && !value.startsWith('-')
  const rest = [...argv.slice(0, index), ...argv.slice(index + (hasValue ? 2 : 1))]
  if (!hasValue || value === 'on' || value === SISU_SANDBOX_PROFILE) return { argv: rest, profile: SISU_SANDBOX_PROFILE }
  if (value === 'off') return { argv: rest, profile: null }
  return { argv: rest, profile: value }
}

export function sandboxPagerArgs(profile: string | null): string[] {
  return profile ? ['--sandbox', profile] : []
}
