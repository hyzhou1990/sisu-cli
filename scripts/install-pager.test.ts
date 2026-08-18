import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
// The installer is a shipped CommonJS file (npm postinstall). Drive that file.
const { SUPPORTED, decodePayload, installPager, releaseAssetUrl, writeBinary } = require('./install-pager.js') as {
  SUPPORTED: Set<string>
  decodePayload: (buf: Buffer) => Buffer
  installPager: (options?: Record<string, unknown>) => Promise<{ ok: boolean; dest?: string; skipped?: boolean }>
  releaseAssetUrl: (version: string, key: string) => string
  writeBinary: (bytes: Buffer, dest: string) => void
}

it('lists darwin-arm64 plus linux and darwin-x64 pager platforms', () => {
  expect([...SUPPORTED].sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].sort())
  for (const key of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const) {
    expect(releaseAssetUrl('0.3.0', key)).toBe(
      `https://github.com/hyzhou1990/sisu-cli/releases/download/v0.3.0/xai-grok-pager-${key}.br`,
    )
  }
})

it('decodes a brotli pager payload like @xai-official/grok', () => {
  const raw = Buffer.from('sisu-grok-pager-fixture')
  const br = zlib.brotliCompressSync(raw)
  expect(decodePayload(br).equals(raw)).toBe(true)
  expect(decodePayload(raw).equals(raw)).toBe(true)
})

it('replaces a stale pager when the package version changes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-pager-upgrade-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  const dest = path.join(home, 'bin', 'xai-grok-pager')
  const oldFile = path.join(home, 'old.br')
  const nextFile = path.join(home, 'next.br')
  const oldRaw = Buffer.from('old-pager')
  const nextRaw = Buffer.from('sisu-0.2.2-pager')
  fs.writeFileSync(oldFile, zlib.brotliCompressSync(oldRaw))
  fs.writeFileSync(nextFile, zlib.brotliCompressSync(nextRaw))
  try {
    await installPager({ file: oldFile, dest, platform: 'darwin-arm64', version: '0.2.1', force: true })
    expect(fs.readFileSync(dest).equals(oldRaw)).toBe(true)
    const skipped = await installPager({ file: nextFile, dest, platform: 'darwin-arm64', version: '0.2.1' })
    expect(skipped.skipped).toBe(true)
    expect(fs.readFileSync(dest).equals(oldRaw)).toBe(true)
    const forced = await installPager({
      file: nextFile,
      dest,
      platform: 'darwin-arm64',
      version: '0.2.1',
      force: true,
    })
    expect(forced.ok).toBe(true)
    expect(forced.skipped).toBeUndefined()
    expect(fs.readFileSync(dest).equals(nextRaw)).toBe(true)
    const upgraded = await installPager({ file: nextFile, dest, platform: 'darwin-arm64', version: '0.2.2' })
    expect(upgraded.ok).toBe(true)
    expect(upgraded.skipped).toBeUndefined()
    expect(fs.readFileSync(dest).equals(nextRaw)).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('installs from a local .br into ~/.sisu/bin', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-pager-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  const payload = path.join(home, 'xai-grok-pager-darwin-arm64.br')
  const raw = Buffer.from('#!/bin/sh\necho grok-pager\n')
  fs.writeFileSync(payload, zlib.brotliCompressSync(raw))
  try {
    const result = await installPager({
      file: payload,
      dest: path.join(home, 'bin', 'xai-grok-pager'),
      platform: 'darwin-arm64',
      force: true,
    })
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(String(result.dest)).equals(raw)).toBe(true)
    expect(releaseAssetUrl('0.2.2', 'darwin-arm64')).toBe(
      'https://github.com/hyzhou1990/sisu-cli/releases/download/v0.2.2/xai-grok-pager-darwin-arm64.br',
    )
    const dest = path.join(home, 'bin', 'copy')
    writeBinary(raw, dest)
    expect(fs.readFileSync(dest).equals(raw)).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
