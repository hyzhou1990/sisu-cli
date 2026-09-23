import fs from 'fs'
import os from 'os'
import path from 'path'

import { getSisuHome } from './store'
import { npmGlobalPrefix } from './update'

export type InstallSource = {
  /** node_modules dir holding the installed package, e.g.
   *  /opt/homebrew/lib/node_modules/@stevezhou/sisu */
  root: string
  /** npm --prefix that owns this install (for the fix command). */
  prefix: string
  version: string
}

export type FindSourcesOptions = {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  /** PATH used to locate `sisu` shims; defaults to process.env.PATH/Path. */
  pathEnv?: string
  /** The running package's own node_modules dir; defaults to src/... */
  packageRoot?: string
  exists?: (file: string) => boolean
  readFile?: (file: string) => string | null
  realpath?: (file: string) => string | null
}

const PKG_REL = path.join('@stevezhou', 'sisu')

function windowsNpmRoot(env: NodeJS.ProcessEnv): string {
  const appData =
    env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'npm', 'node_modules', ...PKG_REL.split(path.sep))
}

function defaultRealpath(file: string): string | null {
  try {
    return fs.realpathSync(file)
  } catch {
    return null
  }
}

function readVersion(
  root: string,
  readFile: (file: string) => string | null,
): string | null {
  try {
    const raw = readFile(path.join(root, 'package.json'))
    if (!raw) return null
    const version = (JSON.parse(raw) as { version?: unknown }).version
    return typeof version === 'string' && version ? version : null
  } catch {
    return null
  }
}

/** Every @stevezhou/sisu install visible from this machine: the private
 *  ~/.sisu copy, the running CLI's own npm prefix, well-known global
 *  locations (/usr/local, %AppData%\npm), and any extra `sisu` on PATH
 *  (Homebrew vs private installs can both be first on PATH in different
 *  shells). Missing or unreadable candidates are skipped. */
export function findInstallSources(options: FindSourcesOptions = {}): InstallSource[] {
  const platform = options.platform || process.platform
  const win = platform === 'win32'
  const home = options.home || getSisuHome()
  const env = options.env || process.env
  const exists = options.exists || ((file: string) => fs.existsSync(file))
  const readFile =
    options.readFile ||
    ((file: string): string | null => {
      try {
        return fs.readFileSync(file, 'utf8')
      } catch {
        return null
      }
    })
  const realpath = options.realpath || defaultRealpath
  const pathSep = win ? ';' : ':'
  const pathEnv = options.pathEnv ?? env.PATH ?? env.Path ?? ''

  const candidates: string[] = []
  const ownPrefix = npmGlobalPrefix(options.packageRoot || path.join(__dirname, '..'))
  if (ownPrefix) {
    candidates.push(path.join(ownPrefix, 'lib', 'node_modules', ...PKG_REL.split(path.sep)))
    candidates.push(path.join(ownPrefix, 'node_modules', ...PKG_REL.split(path.sep)))
  }
  candidates.push(path.join(home, 'lib', 'node_modules', ...PKG_REL.split(path.sep)))
  if (win) {
    candidates.push(windowsNpmRoot(env))
  } else {
    candidates.push(path.join('/usr/local/lib/node_modules', ...PKG_REL.split(path.sep)))
  }

  // PATH shims: resolve each `sisu` to its real target. npm links the global
  // bin into <prefix>/bin, so a shim either lives inside the package itself
  // or sits next to <prefix>/lib/node_modules.
  const shimNames = win ? ['sisu.cmd', 'sisu.exe', 'sisu'] : ['sisu']
  const seenShimDir = new Set<string>()
  for (const dir of pathEnv.split(pathSep)) {
    if (!dir || seenShimDir.has(dir)) continue
    seenShimDir.add(dir)
    for (const name of shimNames) {
      const shim = win ? path.win32.join(dir, name) : path.join(dir, name)
      if (!exists(shim)) continue
      const target = realpath(shim) || shim
      const needle = path.join('node_modules', ...PKG_REL.split(path.sep))
      const idx = target.lastIndexOf(needle)
      if (idx >= 0) {
        candidates.push(target.slice(0, idx + needle.length))
      } else {
        candidates.push(
          path.join(path.dirname(target), '..', 'lib', 'node_modules', ...PKG_REL.split(path.sep)),
        )
      }
      break
    }
  }

  const sources: InstallSource[] = []
  const seen = new Set<string>()
  for (const root of candidates) {
    if (!root || !exists(path.join(root, 'package.json'))) continue
    const key = (realpath(root) || root).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const version = readVersion(root, readFile)
    if (!version) continue
    const prefix = npmGlobalPrefix(root)
    if (!prefix) continue
    sources.push({ root, prefix, version })
  }
  return sources
}

/** Sources whose installed version differs from the version the update
 *  just installed (or, on the no-op path, the running version). */
export function driftedSources(targetVersion: string, sources: InstallSource[]): InstallSource[] {
  return sources.filter((source) => source.version !== targetVersion)
}

export function formatDriftWarning(source: InstallSource, targetVersion: string): string {
  return (
    `sisu: warning — another sisu install is out of sync:\n` +
    `  ${source.root} (${source.version})\n` +
    `Run \`npm i -g @stevezhou/sisu@${targetVersion} --prefix ${source.prefix}\`, or uninstall it.\n`
  )
}
