import { displayWidth, SISU_BRAND, sisuBanner, sisuProductSurfaces, sisuSplash, sisuSplashFrame, sisuSplashHeight, sisuWelcomeCopy, sisuWordmark, stripAnsi } from './logo'

describe('sisu logo', () => {
  it('renders the volumetric ∞ Möbius with the wordmark', () => {
    const splash = sisuSplash(80, false)
    expect(splash).toContain('思溯')
    expect(splash).toContain('SiSu')
    expect(splash).toContain('思有所溯')
    expect(splash).toMatch(/[@%#*+=.-]/)
    expect(stripAnsi(splash)).not.toMatch(/NaN/)
    expect(sisuWordmark()).toMatch(/思/)
    expect(sisuBanner(80, 0, false)).toContain('思有所溯')
  })

  it('keeps splash height stable as the twist travels', () => {
    const height = sisuSplashHeight(80)
    expect(sisuSplashFrame(80, false, 0).split('\n')).toHaveLength(height)
    expect(sisuSplashFrame(80, false, Math.PI).split('\n')).toHaveLength(height)
    expect(sisuSplashFrame(80, false, Math.PI * 2).split('\n')).toHaveLength(height)
    expect(sisuSplash(40, false)).toContain('思有所溯')
  })

  it('paints the brand gradient and measures CJK as two cells', () => {
    const colored = sisuSplash(80, true)
    expect(colored).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/)
    expect(colored).not.toMatch(/NaN/)
    expect(displayWidth('思溯')).toBe(4)
    expect(displayWidth('思有所溯')).toBe(8)
    expect(displayWidth('SiSu')).toBe(4)
  })

  it('first surfaces are 思溯 / SiSu / 思有所溯 with a Möbius frame, not Grok', () => {
    const surfaces = sisuProductSurfaces()
    for (const text of [surfaces.splash, surfaces.welcome, surfaces.helpAbout]) {
      expect(text).toContain(SISU_BRAND.zh)
      expect(text).toMatch(/SiSu|SISU/)
      expect(text).toContain(SISU_BRAND.headline)
      expect(text).not.toMatch(/Grok Build|SpaceXAI|grok\.com/i)
    }
    expect(surfaces.splash).toMatch(/[@%#*+=.-]/)
    expect(sisuWelcomeCopy(true, false).join('\n')).toContain('/login')
    expect(sisuWordmark()).toContain('思溯')
  })
})
