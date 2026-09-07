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
  pathHint: (
    npmBin: string,
    localBin: string,
    pathEnv?: string,
    options?: Record<string, unknown>,
  ) => string
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

it('resolves sisu.cmd from the npm prefix root on Windows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-win-prefix-'))
  const bin = path.join(root, 'sisu.cmd')
  fs.writeFileSync(bin, '@echo off\r\n')
  try {
    expect(globalSisuBin({ prefix: root, platform: 'win32', exists: (file: string) => file === bin })).toBe(bin)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('finds sisu.cmd from process.platform when install options omit platform', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-win-host-'))
  const bin = path.join(root, 'sisu.cmd')
  fs.writeFileSync(bin, '@echo off\r\n')
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  try {
    expect(globalSisuBin({ prefix: root, exists: (file: string) => file === bin })).toBe(bin)
  } finally {
    if (descriptor) Object.defineProperty(process, 'platform', descriptor)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('writes Windows wrappers into %LOCALAPPDATA%\\sisu\\bin that call the original sisu.cmd', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-win-home-'))
  const localAppData = path.join(home, 'AppData', 'Local')
  const target = path.join(home, 'AppData', 'Roaming', 'npm', 'sisu.cmd')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '@echo off\r\nnode main.js %*\r\n')
  try {
    const shim = ensureUserShim(target, { home, platform: 'win32', localAppData })
    expect(shim).toBe(path.join(localAppData, 'sisu', 'bin', 'sisu.cmd'))
    const body = fs.readFileSync(shim as string, 'utf8')
    expect(body).toContain(target)
    expect(body).toMatch(/%\*/)
    const sh = path.join(localAppData, 'sisu', 'bin', 'sisu')
    expect(fs.existsSync(sh)).toBe(true)
    expect(fs.readFileSync(sh, 'utf8')).toMatch(/^#!/)
    expect(fs.readFileSync(path.join(localAppData, 'sisu', 'bin', 'sisu.ps1'), 'utf8')).toContain(target)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('prints cmd, PowerShell, and Git Bash PATH assignments on Windows', () => {
  const localBin = 'C:\\Users\\hanna\\AppData\\Local\\sisu\\bin'
  const hint = pathHint('C:\\Users\\hanna\\AppData\\Roaming\\npm', localBin, 'C:\\Windows\\system32', {
    platform: 'win32',
  })
  expect(hint).toContain(localBin)
  expect(hint).toMatch(/set PATH=/)
  expect(hint).toContain('$env:Path')
  expect(hint).toMatch(/export PATH=/)
  expect(hint).toContain('/c/Users/hanna/AppData/Local/sisu/bin')
})

it('installCliPath on Windows persists the shim directory on the user PATH once', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-win-path-'))
  const localAppData = path.join(home, 'AppData', 'Local')
  const prefix = path.join(home, 'AppData', 'Roaming', 'npm')
  const bin = path.join(prefix, 'sisu.cmd')
  fs.mkdirSync(prefix, { recursive: true })
  fs.writeFileSync(bin, '@echo off\r\n')
  const lines: string[] = []
  let userPath = 'C:\\Windows\\system32'
  try {
    const first = installCliPath({
      prefix,
      home,
      localAppData,
      platform: 'win32',
      pathEnv: 'C:\\Windows\\system32',
      readUserPath: () => userPath,
      writeUserPath: (value: string) => {
        userPath = value
      },
      write: (text: string) => lines.push(text),
    })
    const shimDir = path.join(localAppData, 'sisu', 'bin')
    expect(first.shim).toBe(path.join(shimDir, 'sisu.cmd'))
    expect(userPath.split(';')).toContain(shimDir)
    expect(lines.join('')).toMatch(/set PATH=/)
    expect(lines.join('')).toContain('$env:Path')

    const second = installCliPath({
      prefix,
      home,
      localAppData,
      platform: 'win32',
      pathEnv: userPath,
      readUserPath: () => userPath,
      writeUserPath: (value: string) => {
        userPath = value
      },
      write: () => undefined,
    })
    expect(second.shim).toBe(path.join(shimDir, 'sisu.cmd'))
    expect(userPath.split(';').filter((entry) => entry === shimDir)).toHaveLength(1)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
