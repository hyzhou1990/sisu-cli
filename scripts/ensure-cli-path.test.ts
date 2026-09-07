import fs from 'fs'
import os from 'os'
import path from 'path'

const {
  ensureUserShim,
  globalSisuBin,
  installCliPath,
  pathContains,
  pathHint,
} = require('./ensure-cli-path.js') as {
  ensureUserShim: (target: string, options?: Record<string, unknown>) => string | null
  globalSisuBin: (options?: Record<string, unknown>) => string
  installCliPath: (options?: Record<string, unknown>) => { bin: string; shim: string | null; hint: string }
  pathContains: (dir: string, pathEnv?: string) => boolean
  pathHint: (npmBin: string, localBin: string, pathEnv?: string) => string
}

it('resolves the global sisu from npm_config_prefix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-prefix-'))
  const bin = path.join(root, 'bin', 'sisu')
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(bin, '#!/usr/bin/env node\n')
  try {
    expect(globalSisuBin({ prefix: root, platform: 'linux', exists: (file: string) => file === bin })).toBe(bin)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('links sisu into ~/.local/bin so Debian login PATH can see it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-home-'))
  const target = path.join(home, 'npm', 'bin', 'sisu')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '#!/usr/bin/env node\n')
  try {
    const shim = ensureUserShim(target, { home, platform: 'linux' })
    expect(shim).toBe(path.join(home, '.local', 'bin', 'sisu'))
    expect(fs.lstatSync(shim as string).isSymbolicLink()).toBe(true)
    expect(fs.realpathSync(shim as string)).toBe(fs.realpathSync(target))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('prints a PATH export when neither npm bin nor ~/.local/bin is on PATH', () => {
  expect(pathContains('/opt/bin', '/usr/bin:/bin')).toBe(false)
  expect(pathContains('/usr/bin', '/usr/bin:/bin')).toBe(true)
  const hint = pathHint('/opt/npm/bin', '/home/hanna/.local/bin', '/usr/bin:/bin')
  expect(hint).toContain('/home/hanna/.local/bin')
  expect(hint).toContain('/opt/npm/bin')
  expect(hint).toMatch(/^export PATH=/)
  expect(pathHint('/usr/bin', '/usr/bin', '/usr/bin:/bin')).toBe('')
})

it('installCliPath writes the command location and PATH hint', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-path-'))
  const prefix = path.join(home, 'npm')
  const bin = path.join(prefix, 'bin', 'sisu')
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(bin, '#!/usr/bin/env node\n')
  const lines: string[] = []
  try {
    const result = installCliPath({
      prefix,
      home,
      platform: 'linux',
      pathEnv: '/usr/bin:/bin',
      write: (text: string) => lines.push(text),
    })
    expect(result.shim).toBe(path.join(home, '.local', 'bin', 'sisu'))
    expect(lines.join('')).toMatch(/command -> .*\/.local\/bin\/sisu/)
    expect(lines.join('')).toMatch(/if `sisu` is not found/)
    expect(lines.join('')).toMatch(/export PATH=/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
