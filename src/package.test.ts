import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SISU_CLIENT_VERSION } from './client'

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string
  version: string
  private?: boolean
  bin?: { sisu?: string }
  files?: string[]
  license?: string
}

it('README describes the runtime catalog and pager-only update', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  expect(readme).toMatch(/\/api\/runtime\/v1\/models/)
  expect(readme).toMatch(/sisu update/)
  expect(readme).toMatch(/stamped/)
  expect(readme).not.toMatch(/\/api\/chat\/models/)
  expect(readme).not.toMatch(/Grok Build TUI/)
})

it('is a public sisu package with a sisu bin', () => {
  expect(pkg.name).toBe('@stevezhou/sisu')
  expect(pkg.private).toBeUndefined()
  expect(pkg.bin?.sisu).toBe('dist/main.js')
  expect(pkg.files).toEqual(expect.arrayContaining(['dist']))
  expect(pkg.license).toBe('UNLICENSED')
  expect(SISU_CLIENT_VERSION).toBe(pkg.version)
})

it('npm pack ships the executable and omits tests and sources', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-pack-'))
  try {
    execFileSync('npm', ['pack', '--pack-destination', dest], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tarballs = fs.readdirSync(dest).filter((name) => name.endsWith('.tgz'))
    expect(tarballs).toHaveLength(1)
    const listing = execFileSync('tar', ['-tzf', path.join(dest, tarballs[0])], { encoding: 'utf8' })
    expect(listing).toMatch(/package\/dist\/main\.js/)
    expect(listing).toMatch(/package\/package\.json/)
    expect(listing).toMatch(/package\/README\.md/)
    expect(listing).toMatch(/package\/scripts\/postinstall\.js/)
    expect(listing).toMatch(/package\/scripts\/install-pager\.js/)
    expect(listing).not.toMatch(/commands\.test/)
    expect(listing).not.toMatch(/package\/src\//)
    expect(listing).not.toMatch(/node_modules/)
  } finally {
    fs.rmSync(dest, { recursive: true, force: true })
  }
})
