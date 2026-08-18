import fs from 'fs'
import os from 'os'
import path from 'path'
import { readAuth, writeAuth } from '../store'
import { helpText } from '../main'
import { sisuGrokBuildEnv, writeSisuGrokConfig } from './launch'
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
  expect(boot).toContain('SISU_HOME')
  expect(boot).toContain('auth.json')
  expect(boot).not.toContain('grok.com')
  expect(boot).not.toContain('auth.x.ai')
  const welcome = fs.readFileSync(path.join(grokBuildPath('pager'), 'src', 'views', 'welcome', 'mod.rs'), 'utf8')
  expect(welcome).toMatch(/"SiSu  "/)
  expect(welcome).not.toMatch(/"Grok Build  "/)
  const about = fs.readFileSync(path.join(grokBuildPath('pager'), 'src', 'app', 'cli.rs'), 'utf8')
  expect(about).toContain('SiSu TUI')
  expect(about).toContain('思有所溯')
  expect(about).not.toContain('about = "Grok Build TUI"')
  const logoRs = fs.readFileSync(path.join(grokBuildPath('pager'), 'src', 'views', 'welcome', 'logo.rs'), 'utf8')
  expect(logoRs).toContain('Möbius')
  expect(logoRs).toContain('mobius::render_frame')
  const mobiusRs = fs.readFileSync(path.join(grokBuildPath('pager'), 'src', 'views', 'welcome', 'mobius.rs'), 'utf8')
  expect(mobiusRs).toContain('lemniscate')
  expect(mobiusRs).toContain('half-twist')
  const hero = fs.readFileSync(path.join(grokBuildPath('pager'), 'src', 'views', 'welcome', 'hero_box.rs'), 'utf8')
  expect(hero).toContain('思有所溯 · 思溯 SiSu')
  const bootMain = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-pager-bin', 'src', 'main.rs'),
    'utf8',
  )
  expect(bootMain).toContain('SiSu TUI — 思溯 · 思有所溯')
  expect(bootMain).toContain('sisu_access_point::enforce()')
  expect(bootMain).toContain('run sisu update')
  expect(bootMain).not.toContain('"Grok Build (pager)')
  const autoUpdate = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-update', 'src', 'auto_update.rs'),
    'utf8',
  )
  expect(autoUpdate).toContain('sisu_access_point::active()')
  expect(autoUpdate).toContain('run sisu update')
  const accessPoint = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-pager-bin', 'src', 'sisu_access_point.rs'),
    'utf8',
  )
  expect(accessPoint).toContain('pub fn enforce()')
  expect(accessPoint).toContain('is_sisu_runtime_url')
  expect(accessPoint).toContain('run `sisu`')
  expect(accessPoint).not.toMatch(/set_var\(\s*"XAI_API_KEY"/)
  expect(accessPoint).not.toContain('read_to_string')
  expect(boot).toContain('SISU_ACCESS_POINT')
  const homeLib = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-home', 'src', 'lib.rs'),
    'utf8',
  )
  expect(homeLib).toContain('GROK_HOME')
  expect(homeLib).toContain('resolve_grok_home_from_envs')
  const resolution = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-shell', 'src', 'agent', 'models', 'resolution.rs'),
    'utf8',
  )
  expect(resolution).toContain('sisu_access_point::active()')
  expect(resolution).toContain('no SiSu model available')
  expect(resolution).toContain('fn first_or_fallback')
  const billing = fs.readFileSync(
    path.join(grokBuildPath('pager'), 'src', 'app', 'dispatch', 'billing.rs'),
    'utf8',
  )
  expect(billing).toContain('sisu_access_point::active()')
  expect(billing).toContain('https://www.sisu.chat')
  expect(billing).toContain('SiSu 充值')
  expect(billing).toContain('配额')
  expect(billing).not.toMatch(/const UPSELL_URL_UPGRADE:\s*&str\s*=\s*"https:\/\/grok\.com\/supergrok/)
  const minimal = fs.readFileSync(
    path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-pager-minimal', 'src', 'welcome.rs'),
    'utf8',
  )
  expect(minimal).toContain('"SiSu"')
  expect(minimal).not.toContain('"Grok Build"')
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
    const env = sisuGrokBuildEnv()
    expect(env.XAI_API_KEY).toBe('sisu-jwt')
    expect(env.GROK_XAI_API_BASE_URL).toBe('https://www.sisu.chat/api/runtime/v1')
    expect(env.GROK_HOME).toBe(path.join(home, 'engine'))
    expect(env.SISU_HOME).toBeUndefined()
    expect(writeSisuGrokConfig()).toBe(path.join(home, 'engine', 'config.toml'))
    expect(helpText()).not.toMatch(/grok\.com|auth\.x\.ai|SpaceXAI/)
    expect(helpText()).toContain('~/.sisu')
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
