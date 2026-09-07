#!/usr/bin/env node
/** After `npm i -g`, put `sisu` on a PATH users actually have.
 *  npm's global bin is often missing from Debian/login PATH and from Windows PATH.
 *  Do not copy npm's sisu.cmd: it uses %~dp0 and breaks outside the prefix.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

function isWin(options = {}) {
  return (options.platform || process.platform) === 'win32'
}

function pathDelim(options = {}) {
  if (options.delimiter) return options.delimiter
  return isWin(options) ? ';' : options.platform ? ':' : path.delimiter
}

function pathDirs(pathEnv = process.env.PATH || '', options = {}) {
  return pathEnv.split(pathDelim(options)).filter(Boolean)
}

function normalizePathEntry(dir, options = {}) {
  if (isWin(options)) {
    return String(dir).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }
  try {
    return path.resolve(dir)
  } catch {
    return dir
  }
}

function pathContains(dir, pathEnv = process.env.PATH || '', options = {}) {
  const target = normalizePathEntry(dir, options)
  return pathDirs(pathEnv, options).some((entry) => normalizePathEntry(entry, options) === target)
}

function globalSisuBin(options = {}) {
  const win = isWin(options)
  const name = win ? 'sisu.cmd' : 'sisu'
  const prefix = options.prefix || process.env.npm_config_prefix || ''
  const fromPrefix = prefix
    ? (win ? path.join(prefix, name) : path.join(prefix, 'bin', name))
    : ''
  const fromLayout = path.resolve(
    options.packageRoot || path.join(__dirname, '..'),
    '..',
    '..',
    win ? name : path.join('bin', name),
  )
  const exists = options.exists || ((file) => fs.existsSync(file))
  for (const candidate of [fromPrefix, fromLayout]) {
    if (candidate && exists(candidate)) return candidate
  }
  return fromPrefix || fromLayout
}

function userLocalBin(home = os.homedir(), options = {}) {
  if (isWin(options)) {
    const localAppData =
      options.localAppData || process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return path.join(localAppData, 'sisu', 'bin')
  }
  return path.join(home, '.local', 'bin')
}

function toGitBashPath(winPath) {
  const normalized = String(winPath).replace(/\\/g, '/')
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (drive) return `/${drive[1].toLowerCase()}/${drive[2]}`
  return normalized
}

function writeShim(dest, body) {
  fs.writeFileSync(dest, body)
  try {
    fs.chmodSync(dest, 0o755)
  } catch {
    // Windows may ignore chmod; the file still runs via PATHEXT / shebang
  }
}

function ensureUserShim(target, options = {}) {
  if (!target) return null
  const dir = userLocalBin(options.home || os.homedir(), options)
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
  if (isWin(options)) {
    return writeWindowsWrappers(target, dir, options)
  }
  const dest = path.join(dir, 'sisu')
  try {
    if (fs.lstatSync(dest)) fs.unlinkSync(dest)
  } catch {
    // missing
  }
  fs.symlinkSync(path.resolve(target), dest)
  try {
    fs.chmodSync(dest, 0o755)
  } catch {
    // symlink mode follows the target on most POSIX
  }
  return dest
}

function writeWindowsWrappers(target, dir, options = {}) {
  const exists = options.exists || ((file) => fs.existsSync(file))
  const cmdTarget = String(target).replace(/"/g, '')
  const cmdDest = path.join(dir, 'sisu.cmd')
  writeShim(cmdDest, `@echo off\r\ncall "${cmdTarget}" %*\r\n`)

  const ps1Source = cmdTarget.replace(/\.cmd$/i, '.ps1')
  const ps1Target = exists(ps1Source) ? ps1Source : cmdTarget
  writeShim(path.join(dir, 'sisu.ps1'), `& "${ps1Target.replace(/"/g, '')}" @args\r\n`)

  const shSource = cmdTarget.replace(/\.cmd$/i, '')
  const shTarget = exists(shSource) ? shSource : cmdTarget
  writeShim(path.join(dir, 'sisu'), `#!/bin/sh\nexec "${toGitBashPath(shTarget).replace(/"/g, '')}" "$@"\n`)
  return cmdDest
}

function pathHint(npmBin, localBin, pathEnv = process.env.PATH || '', options = {}) {
  const dirs = []
  if (localBin && !pathContains(localBin, pathEnv, options)) dirs.push(localBin)
  if (npmBin && !pathContains(npmBin, pathEnv, options)) dirs.push(npmBin)
  if (!dirs.length) return ''
  if (isWin(options)) {
    const joined = dirs.join(';')
    const git = dirs.map(toGitBashPath).join(':')
    return [
      `set PATH=${joined};%PATH%`,
      `$env:Path = "${joined};" + $env:Path`,
      `export PATH="${git}:$PATH"`,
    ].join('\n  ')
  }
  return `export PATH="${dirs.join(':')}:$PATH" && hash -r`
}

function readWindowsUserPath() {
  const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const line = out.split(/\r?\n/).find((row) => /\bPath\s+REG_/i.test(row))
  if (!line) return ''
  const match = line.match(/REG_\w+\s+(.*)$/)
  return match ? match[1].trim() : ''
}

function writeWindowsUserPath(value) {
  execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function persistUserPath(dir, options = {}) {
  if (!isWin(options) || !dir) return { added: false }
  const read = options.readUserPath || readWindowsUserPath
  const write = options.writeUserPath || writeWindowsUserPath
  const current = String(read() || '')
  if (pathContains(dir, current, options)) return { added: false }
  const next = current ? `${current.replace(/;+$/, '')};${dir}` : dir
  write(next)
  return { added: true }
}

function installCliPath(options = {}) {
  const writes = options.write || ((text) => process.stdout.write(text))
  const bin = globalSisuBin(options)
  const npmBinDir = bin ? path.dirname(bin) : ''
  let shim = null
  try {
    shim = ensureUserShim(bin, options)
  } catch (error) {
    writes(`sisu: could not install user command (${error instanceof Error ? error.message : String(error)})\n`)
  }
  const localDir = shim ? path.dirname(shim) : userLocalBin(options.home, options)
  try {
    const persisted = persistUserPath(localDir, options)
    if (persisted.added) writes('sisu: added to user PATH (new terminals will see it)\n')
  } catch (error) {
    writes(`sisu: could not update user PATH (${error instanceof Error ? error.message : String(error)})\n`)
  }
  const hint = pathHint(npmBinDir, localDir, options.pathEnv, options)
  if (bin) writes(`sisu: command -> ${shim || bin}\n`)
  if (hint) {
    writes('sisu: if `sisu` is not found in this shell, run:\n')
    writes(`  ${hint}\n`)
  }
  return { bin, shim, hint }
}

module.exports = {
  ensureUserShim,
  globalSisuBin,
  installCliPath,
  pathContains,
  pathHint,
  persistUserPath,
  userLocalBin,
}

if (require.main === module) {
  installCliPath()
}
