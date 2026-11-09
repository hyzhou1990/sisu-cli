import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  canKernelDeny,
  readSandboxSetting,
  resolveSandbox,
  sandboxDenyPaths,
  sandboxPagerArgs,
  SISU_SANDBOX_PROFILE,
  writeSandboxSetting,
  writeSisuSandboxProfile,
} from './sandbox'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-sandbox-'))

describe('sisu sandbox', () => {
  it('maps the flag forms onto a pager profile', () => {
    expect(resolveSandbox(['--sandbox'], false)).toEqual({ argv: [], profile: 'sisu' })
    expect(resolveSandbox(['--sandbox', 'on', '--resume', 'x'], false)).toEqual({ argv: ['--resume', 'x'], profile: 'sisu' })
    expect(resolveSandbox(['--sandbox', '--resume', 'x'], false)).toEqual({ argv: ['--resume', 'x'], profile: 'sisu' })
    expect(resolveSandbox(['--sandbox', 'strict'], false).profile).toBe('strict')
    expect(resolveSandbox(['--sandbox', 'off'], true)).toEqual({ argv: [], profile: null })
    expect(resolveSandbox([], false, {}).profile).toBeNull()
    expect(resolveSandbox([], true, {}).profile).toBe('sisu')
    expect(resolveSandbox([], false, { SISU_SANDBOX: '1' }).profile).toBe('sisu')
    expect(sandboxPagerArgs('sisu')).toEqual(['--sandbox', 'sisu'])
    expect(sandboxPagerArgs(null)).toEqual([])
  })

  it('denies credential stores with absolute paths and project secrets by glob', () => {
    const deny = sandboxDenyPaths('/home/u')
    expect(deny).toContain('/home/u/.ssh')
    expect(deny).toContain('/home/u/.config/gh')
    expect(deny).toContain('**/.env')
    expect(deny.some((item) => item.startsWith('~'))).toBe(false)
  })

  it('only kernel-denies where the engine can enforce it', () => {
    expect(canKernelDeny('darwin', () => false)).toBe(true)
    expect(canKernelDeny('linux', () => true)).toBe(true)
    expect(canKernelDeny('linux', () => false)).toBe(false)
    expect(canKernelDeny('win32', () => true)).toBe(false)
  })

  it('writes the managed profile, drops deny without bubblewrap, and never overwrites a user file', () => {
    const engine = tmp()
    const mac = writeSisuSandboxProfile(engine, { home: '/home/u', platform: 'darwin' })
    const body = fs.readFileSync(mac.file, 'utf8')
    expect(mac).toMatchObject({ written: true, denyActive: true })
    expect(body).toContain(`[profiles.${SISU_SANDBOX_PROFILE}]`)
    expect(body).toContain('extends = "workspace"')
    expect(body).toContain('"/home/u/.ssh"')

    const linux = writeSisuSandboxProfile(engine, { home: '/home/u', platform: 'linux', hasBwrap: () => false })
    expect(linux.denyActive).toBe(false)
    expect(fs.readFileSync(linux.file, 'utf8')).not.toContain('deny')

    fs.writeFileSync(linux.file, '[profiles.mine]\nextends = "strict"\n')
    expect(writeSisuSandboxProfile(engine, { platform: 'darwin' }).written).toBe(false)
    expect(fs.readFileSync(linux.file, 'utf8')).toContain('profiles.mine')
  })

  it('persists the opt-in', () => {
    const home = tmp()
    expect(readSandboxSetting(home)).toBe(false)
    writeSandboxSetting(home, true)
    expect(readSandboxSetting(home)).toBe(true)
    writeSandboxSetting(home, false)
    expect(readSandboxSetting(home)).toBe(false)
  })
})
