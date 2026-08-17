import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
// The installer is a shipped CommonJS file (npm postinstall). Drive that file.
const { decodePayload, installPager, releaseAssetUrl, writeBinary } = require('./install-pager.js') as {
  decodePayload: (buf: Buffer) => Buffer
  installPager: (options?: Record<string, unknown>) => Promise<{ ok: boolean; dest?: string }>
  releaseAssetUrl: (version: string, key: string) => string
  writeBinary: (bytes: Buffer, dest: string) => void
}

it('decodes a brotli pager payload like @xai-official/grok', () => {
  const raw = Buffer.from('sisu-grok-pager-fixture')
  const br = zlib.brotliCompressSync(raw)
  expect(decodePayload(br).equals(raw)).toBe(true)
  expect(decodePayload(raw).equals(raw)).toBe(true)
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
    expect(releaseAssetUrl('0.2.1', 'darwin-arm64')).toBe(
      'https://github.com/hyzhou1990/sisu-cli/releases/download/v0.2.1/xai-grok-pager-darwin-arm64.br',
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
