import { displayWidth, sisuBanner, sisuSplash, sisuTreeArt, sisuWordmark, stripAnsi } from './logo'
import { sisuTreeHeight, sisuTreeLines } from './tree'

describe('sisu logo', () => {
  it('renders the login-page tree, not a Möbius ribbon', () => {
    const splash = sisuSplash(80, false)
    expect(splash).toContain('思溯')
    expect(splash).toContain('SiSu')
    expect(splash).toContain('思有所溯')
    expect(splash).toContain('落笔成档')
    expect(splash).toMatch(/│|╱|╲/)
    expect(splash).toContain('•')
    expect(stripAnsi(sisuTreeArt(80, false))).not.toMatch(/NaN/)
    expect(sisuTreeLines(80).length).toBe(sisuTreeHeight(80))
    expect(sisuWordmark()).toMatch(/思/)
    expect(sisuBanner(80, 0, false)).toContain('思有所溯')
    const trunks = splash.split('\n').map((line) => line.indexOf('│')).filter((i) => i >= 0)
    expect(new Set(trunks).size).toBe(1)
  })

  it('uses a compact tree on narrow terminals', () => {
    expect(sisuTreeLines(40)[0].length).toBeLessThan(sisuTreeLines(80)[0].length)
    expect(sisuTreeLines(40).length).toBeLessThan(sisuTreeLines(80).length)
    expect(sisuSplash(40, false)).toContain('思有所溯')
    expect(sisuSplash(40, false)).not.toContain('落笔成档')
  })

  it('paints fruit terracotta and measures CJK as two cells', () => {
    const colored = sisuSplash(80, true)
    expect(colored).toContain('\x1b[38;2;184;90;58m')
    expect(colored).toContain('\x1b[38;2;')
    expect(colored).not.toMatch(/NaN/)
    expect(displayWidth('思溯')).toBe(4)
    expect(displayWidth('思有所溯')).toBe(8)
    expect(displayWidth('SiSu')).toBe(4)
  })
})
