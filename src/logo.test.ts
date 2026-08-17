import { displayWidth, sisuBanner, sisuSplash, sisuSplashFrame, sisuSplashHeight, sisuTreeArt, sisuWordmark, stripAnsi } from './logo'

describe('sisu logo', () => {
  it('renders the login-page tree as a volumetric painting', () => {
    const splash = sisuSplash(80, false)
    expect(splash).toContain('思溯')
    expect(splash).toContain('SiSu')
    expect(splash).toContain('思有所溯')
    expect(splash).toContain('落笔成档')
    expect(splash).toMatch(/[@%#*+=.-]/)
    expect(splash).toContain('\u2022')
    expect(stripAnsi(sisuTreeArt(80, false))).not.toMatch(/NaN/)
    expect(sisuWordmark()).toMatch(/思/)
    expect(sisuBanner(80, 0, false)).toContain('思有所溯')
  })

  it('keeps splash height stable across grow and orbit', () => {
    const height = sisuSplashHeight(80)
    expect(sisuSplashFrame(80, false, 0.2, 0.2).split('\n')).toHaveLength(height)
    expect(sisuSplashFrame(80, false, 2.1, 1).split('\n')).toHaveLength(height)
    expect(sisuSplash(40, false)).toContain('思有所溯')
    expect(sisuSplash(40, false)).not.toContain('落笔成档')
  })

  it('paints fruit terracotta and measures CJK as two cells', () => {
    const colored = sisuSplash(80, true)
    expect(colored).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/)
    expect(colored).toContain('\u2022')
    expect(colored).not.toMatch(/NaN/)
    expect(displayWidth('思溯')).toBe(4)
    expect(displayWidth('思有所溯')).toBe(8)
    expect(displayWidth('SiSu')).toBe(4)
  })
})
