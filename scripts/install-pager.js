#!/usr/bin/env node
/** Install the grok-build pager the same way @xai-official/grok does:
 *  tiny npm package + platform binary (brotli) unpacked into ~/.sisu/bin.
 */
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const SUPPORTED = new Set(['darwin-arm64'])
const BIN = process.platform === 'win32' ? 'xai-grok-pager.exe' : 'xai-grok-pager'

function readVersion() {
  try {
    return require('../package.json').version
  } catch {
    return ''
  }
}

function sisuHome() {
  const override = (process.env.SISU_HOME || '').trim()
  if (override) return override
  return path.join(os.homedir(), '.sisu')
}

function pagerBinDir() {
  return path.join(sisuHome(), 'bin')
}

function pagerBinPath() {
  return path.join(pagerBinDir(), BIN)
}

function platformKey() {
  return `${process.platform}-${process.arch}`
}

function releaseAssetUrl(version, key) {
  return `https://github.com/hyzhou1990/sisu-cli/releases/download/v${version}/xai-grok-pager-${key}.br`
}

function writeBinary(bytes, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
  const tmp = `${dest}.tmp.${process.pid}`
  fs.writeFileSync(tmp, bytes)
  if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755)
  fs.renameSync(tmp, dest)
}

function decodePayload(buf) {
  try {
    return zlib.brotliDecompressSync(buf)
  } catch {
    return buf
  }
}

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'sisu-cli' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        download(res.headers.location).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`download ${url} failed (${res.statusCode})`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(120_000, () => {
      req.destroy(new Error('download timed out'))
    })
  })
}

async function installPager(options = {}) {
  const key = options.platform || platformKey()
  const version = options.version || readVersion()
  const dest = options.dest || pagerBinPath()
  if (!SUPPORTED.has(key)) {
    return { ok: false, skipped: true, reason: `no prebuilt pager for ${key}` }
  }
  if (!options.force && fs.existsSync(dest)) {
    return { ok: true, dest, skipped: true, reason: 'already installed' }
  }
  if (options.file) {
    const raw = decodePayload(fs.readFileSync(options.file))
    writeBinary(raw, dest)
    return { ok: true, dest }
  }
  if (!version) return { ok: false, reason: 'missing package version' }
  const url = options.url || releaseAssetUrl(version, key)
  const payload = await download(url)
  writeBinary(decodePayload(payload), dest)
  return { ok: true, dest, url }
}

module.exports = {
  SUPPORTED,
  decodePayload,
  installPager,
  pagerBinPath,
  platformKey,
  releaseAssetUrl,
  writeBinary,
}

if (require.main === module) {
  installPager({ force: process.argv.includes('--force') }).then(
    (result) => {
      if (result.ok) {
        if (!result.skipped) process.stdout.write(`installed grok pager to ${result.dest}\n`)
        process.exit(0)
      }
      process.stderr.write(`sisu pager: ${result.reason}\n`)
      process.exit(result.skipped ? 0 : 1)
    },
    (error) => {
      process.stderr.write(`sisu pager: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    },
  )
}
