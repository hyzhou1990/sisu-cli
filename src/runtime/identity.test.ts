import fs from 'fs'
import os from 'os'
import path from 'path'
import { readAuth, writeAuth } from '../store'
import { PRODUCT_BIN, PRODUCT_NAME, assertGrokBuildSuite, grokBuildPath, grokBuildSuitePresent } from './suite'

it('vendors the grok-build suite plus Apache NOTICE/LICENSE', () => {
  const rows = grokBuildSuitePresent()
  if (!rows.every((row) => row.ok)) {
    // npm/CI pack does not ship the Rust tree; local checkouts may.
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'NOTICE'))).toBe(true)
    return
  }
  assertGrokBuildSuite()
  const license = fs.readFileSync(grokBuildPath('license'), 'utf8')
  expect(license).toMatch(/Apache License/)
  expect(license).toMatch(/SpaceXAI|xAI/)
  const notice = fs.readFileSync(grokBuildPath('notice'), 'utf8')
  expect(notice).toMatch(/SiSu/)
  expect(notice).toMatch(/grok-build/)
  expect(fs.existsSync(path.join(grokBuildPath('tools'), 'src', 'implementations', 'grok_build', 'read_file'))).toBe(true)
  expect(fs.existsSync(path.join(grokBuildPath('pager'), 'src'))).toBe(true)
  const boot = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-pager-bin', 'src', 'sisu_boot.rs'),
    'utf8',
  )
  expect(boot).toContain('GROK_XAI_API_BASE_URL')
  expect(boot).toContain('GROK_TELEMETRY_ENABLED')
})

it('SiSu identity reads ~/.sisu auth and brands the product', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-id-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  try {
    writeAuth({
      token: 'sisu-jwt',
      email: 'ada@sisu.chat',
      user_id: 'u1',
      api_base: 'https://www.sisu.chat',
    })
    const auth = readAuth()
    expect(auth?.token).toBe('sisu-jwt')
    expect(auth?.api_base).toBe('https://www.sisu.chat')
    expect(fs.existsSync(path.join(home, 'auth.json'))).toBe(true)
    expect(PRODUCT_NAME).toBe('SiSu')
    expect(PRODUCT_BIN).toBe('sisu')
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
