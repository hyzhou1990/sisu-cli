#!/usr/bin/env node
/** After `npm i -g`, put `sisu` on a PATH users actually have.
 *  npm's global bin is often missing from Debian/login PATH.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

function pathDirs(pathEnv = process.env.PATH || '') {
  return pathEnv.split(path.delimiter).filter(Boolean)
}

function pathContains(dir, pathEnv = process.env.PATH || '') {
  const target = path.resolve(dir)
  return pathDirs(pathEnv).some((entry) => {
    try {
      return path.resolve(entry) === target
    } catch {
      return false
    }
  })
}

function globalSisuBin(options = {}) {
  const name = options.platform === 'win32' ? 'sisu.cmd' : 'sisu'
  const prefix = options.prefix || process.env.npm_config_prefix || ''
  const fromPrefix = prefix
    ? (options.platform === 'win32' ? path.join(prefix, name) : path.join(prefix, 'bin', name))
    : ''
  const fromLayout = path.resolve(
    options.packageRoot || path.join(__dirname, '..'),
    '..',
    '..',
    options.platform === 'win32' ? name : path.join('bin', name),
  )
  const exists = options.exists || ((file) => fs.existsSync(file))
  for (const candidate of [fromPrefix, fromLayout]) {
    if (candidate && exists(candidate)) return candidate
  }
  return fromPrefix || fromLayout
}

function userLocalBin(home = os.homedir()) {
  return path.join(home, '.local', 'bin')
}

function ensureUserShim(target, options = {}) {
  if ((options.platform || process.platform) === 'win32') return null
  if (!target) return null
  const dir = userLocalBin(options.home || os.homedir())
  const dest = path.join(dir, 'sisu')
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
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

function pathHint(npmBin, localBin, pathEnv = process.env.PATH || '') {
  const dirs = []
  if (localBin && !pathContains(localBin, pathEnv)) dirs.push(localBin)
  if (npmBin && !pathContains(npmBin, pathEnv)) dirs.push(npmBin)
  if (!dirs.length) return ''
  return `export PATH="${dirs.join(':')}:$PATH" && hash -r`
}

function installCliPath(options = {}) {
  const writes = options.write || ((text) => process.stdout.write(text))
  const platform = options.platform || process.platform
  const bin = globalSisuBin(options)
  const npmBinDir = bin ? path.dirname(bin) : ''
  let shim = null
  try {
    shim = ensureUserShim(bin, options)
  } catch (error) {
    writes(`sisu: could not link ~/.local/bin/sisu (${error instanceof Error ? error.message : String(error)})\n`)
  }
  const localDir = shim ? path.dirname(shim) : userLocalBin(options.home)
  const hint = pathHint(npmBinDir, localDir, options.pathEnv)
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
  userLocalBin,
}

if (require.main === module) {
  installCliPath()
}
