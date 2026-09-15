import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { installNpmPackage, npmInstallCwd } from './update'

function writeProbe(dir: string) {
  const probe = path.join(dir, 'probe.cjs')
  fs.writeFileSync(
    probe,
    `
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const trap = process.env.TRAP;
if (trap === 'chmod-parent') {
  try { fs.chmodSync(path.dirname(process.cwd()), 0); } catch {}
} else if (trap === 'unlink-cwd') {
  try { fs.rmSync(process.cwd(), { recursive: true, force: true }); } catch {}
}
const snippet = 'try { process.stdout.write(process.cwd()) } catch (e) { process.stderr.write(String(e.code||"ERR")); process.exit(7) }';
const inherit = spawnSync(process.execPath, ['-e', snippet], { encoding: 'utf8' });
const safe = spawnSync(process.execPath, ['-e', snippet], { encoding: 'utf8', cwd: process.env.SAFE_CWD });
const npmInherit = spawnSync('npm', ['--version'], { encoding: 'utf8' });
const npmSafe = spawnSync('npm', ['--version'], { encoding: 'utf8', cwd: process.env.SAFE_CWD });
process.stdout.write(JSON.stringify({
  inherit: inherit.status,
  inheritCode: (inherit.stderr || '').includes('uv_cwd') || inherit.status === 7,
  safe: safe.status,
  npmInherit: npmInherit.status,
  npmInheritCwd: (npmInherit.stderr || '').includes('uv_cwd'),
  npmSafe: npmSafe.status,
}));
if (trap === 'chmod-parent') {
  try { fs.chmodSync(path.dirname(process.cwd()), 0o755); } catch {}
}
`,
  )
  return probe
}

function runTrap(trap: 'chmod-parent' | 'unlink-cwd') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-robust-'))
  const desktop = path.join(root, 'Desktop', 'SiSu-claude')
  fs.mkdirSync(desktop, { recursive: true })
  const probe = writeProbe(desktop)
  try {
    const result = spawnSync(process.execPath, [probe], {
      cwd: desktop,
      encoding: 'utf8',
      env: { ...process.env, TRAP: trap, SAFE_CWD: os.homedir() },
    })
    try {
      fs.chmodSync(path.dirname(desktop), 0o755)
    } catch {
      /* ignore */
    }
    const payload = JSON.parse(result.stdout || '{}')
    return { status: result.status, payload, stderr: result.stderr }
  } finally {
    try {
      fs.chmodSync(path.dirname(desktop), 0o755)
    } catch {
      /* ignore */
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

it('chmod-parent trap: inherited cwd kills npm, explicit home cwd survives', () => {
  const { status, payload, stderr } = runTrap('chmod-parent')
  expect(status).toBe(0)
  expect(stderr).toBe('')
  expect(payload.inheritCode).toBe(true)
  expect(payload.inherit).toBe(7)
  expect(payload.safe).toBe(0)
  expect(payload.npmInheritCwd).toBe(true)
  expect(payload.npmInherit).toBe(7)
  expect(payload.npmSafe).toBe(0)
})

it('deleted-cwd trap: inherited uv_cwd fails, explicit home cwd survives', () => {
  const { status, payload } = runTrap('unlink-cwd')
  expect(status).toBe(0)
  expect(payload.inherit).toBe(7)
  expect(payload.safe).toBe(0)
  expect(payload.npmInheritCwd).toBe(true)
  expect(payload.npmSafe).toBe(0)
})

it('npmInstallCwd falls back when SISU_HOME is missing or unreadable', () => {
  const missing = path.join(os.tmpdir(), `sisu-missing-${process.pid}`)
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-blocked-'))
  fs.chmodSync(blocked, 0)
  try {
    const fromMissing = npmInstallCwd(missing)
    const fromBlocked = npmInstallCwd(blocked)
    expect([os.homedir(), os.tmpdir()]).toContain(fromMissing)
    expect([os.homedir(), os.tmpdir()]).toContain(fromBlocked)
  } finally {
    try {
      fs.chmodSync(blocked, 0o755)
    } catch {
      /* ignore */
    }
    fs.rmSync(blocked, { recursive: true, force: true })
  }
})

it('installNpmPackage still points spawn at the safe cwd under a trap', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-home-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  const spawn = jest.fn().mockReturnValue({ status: 0 })
  try {
    installNpmPackage('0.3.24', { npm: 'npm', prefix: '', spawn: spawn as never })
    expect(spawn.mock.calls[0][2].cwd).toBe(home)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
