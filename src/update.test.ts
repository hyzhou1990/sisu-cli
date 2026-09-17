import fs from 'fs'
import os from 'os'
import path from 'path'

import { installNpmPackage, npmGlobalPrefix, npmInstallCwd, npmInvocation, planUpdate } from './update'

it('plans a CLI upgrade when npm latest is newer than this process', () => {
  expect(planUpdate('0.3.17', '0.3.18')).toEqual({ action: 'upgrade', from: '0.3.17', to: '0.3.18' })
  expect(planUpdate('0.3.18', '0.3.18')).toEqual({ action: 'pager', version: '0.3.18' })
  expect(planUpdate('0.3.18', null)).toEqual({ action: 'upgrade', from: '0.3.18', to: 'latest' })
})

it('resolves the npm --prefix from a unix global install layout', () => {
  expect(npmGlobalPrefix('/home/ada/.sisu/lib/node_modules/@stevezhou/sisu')).toBe('/home/ada/.sisu')
  expect(npmGlobalPrefix('/usr/local/lib/node_modules/@stevezhou/sisu')).toBe('/usr/local')
})

it('resolves the npm --prefix from a Windows global install layout', () => {
  const root = process.platform === 'win32' ? 'C:\\Users\\ada\\AppData\\Roaming\\npm' : path.join(os.tmpdir(), 'npm')
  const pkg = path.join(root, 'node_modules', '@stevezhou', 'sisu')
  expect(npmGlobalPrefix(pkg)).toBe(root)
})

it('picks SISU_HOME as the npm install cwd', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-update-cwd-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  try {
    expect(npmInstallCwd()).toBe(home)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
  }
})

it('runs npm install with an explicit readable cwd, not the caller directory', () => {
  const spawn = jest.fn().mockReturnValue({ status: 0 })
  installNpmPackage('0.3.23', {
    npm: 'npm',
    prefix: '/tmp/prefix',
    spawn: spawn as never,
    cwd: '/tmp/safe-update',
  })
  expect(spawn).toHaveBeenCalledWith(
    'npm',
    ['install', '-g', '@stevezhou/sisu@0.3.23', '--prefix', '/tmp/prefix'],
    expect.objectContaining({ cwd: '/tmp/safe-update', stdio: 'inherit' }),
  )
})

it('surfaces the errno when npm cannot even be spawned', () => {
  const spawn = jest.fn().mockReturnValue({ status: null, error: { code: 'EINVAL' } })
  expect(() =>
    installNpmPackage('0.3.23', { npm: 'npm', prefix: '/tmp/p', spawn: spawn as never, cwd: '/tmp' }),
  ).toThrow(/spawn EINVAL/)
})

// Windows ships npm as a batch shim and Node refuses to spawn `.cmd`/`.bat`
// without a shell (CVE-2024-27980 fix). Spawning it directly is what made
// `sisu update` die with EINVAL on Windows; follow the shim to its JS entry.
describe('npmInvocation on Windows', () => {
  const win = path.win32
  const dir = 'C:\\Users\\ada\\.sisu\\node'
  const nodeExe = win.join(dir, 'node.exe')
  const cli = win.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')

  const existsFor = (present: string[]) => (file: string) => present.includes(file)

  it('runs node with npm-cli.js instead of the .cmd shim', () => {
    expect(
      npmInvocation(win.join(dir, 'npm.cmd'), ['install', '-g', 'x'], {
        platform: 'win32',
        exists: existsFor([nodeExe, cli]),
      }),
    ).toEqual({ file: nodeExe, args: [cli, 'install', '-g', 'x'] })
  })

  it('resolves a bare npm.cmd through PATH before following it', () => {
    const shim = win.join('C:\\Program Files\\nodejs', 'npm.cmd')
    const shimNode = win.join('C:\\Program Files\\nodejs', 'node.exe')
    const shimCli = win.join('C:\\Program Files\\nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    expect(
      npmInvocation('npm.cmd', ['install'], {
        platform: 'win32',
        pathEnv: ['C:\\Windows\\System32', 'C:\\Program Files\\nodejs'].join(';'),
        exists: existsFor([shim, shimNode, shimCli]),
      }),
    ).toEqual({ file: shimNode, args: [shimCli, 'install'] })
  })

  it('leaves a non-shim npm alone', () => {
    expect(npmInvocation('npm', ['install'], { platform: 'win32' })).toEqual({
      file: 'npm',
      args: ['install'],
    })
  })

  it('keeps the shim when its node/npm-cli.js cannot be found', () => {
    // Better a clear spawn error than a silently wrong command.
    expect(
      npmInvocation(win.join(dir, 'npm.cmd'), ['install'], {
        platform: 'win32',
        exists: () => false,
      }),
    ).toEqual({ file: win.join(dir, 'npm.cmd'), args: ['install'] })
  })

  it('is a no-op off Windows', () => {
    expect(npmInvocation('npm', ['install'], { platform: 'darwin' })).toEqual({
      file: 'npm',
      args: ['install'],
    })
  })
})
