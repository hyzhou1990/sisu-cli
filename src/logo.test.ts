import { sisuBanner, sisuMarkArt, sisuSplash, sisuWordmark, stripAnsi } from './logo'
import { markRgb, sisuMarkHeight, sisuMarkLines } from './mark'

describe('sisu logo', () => {
  it('renders the web Möbius mark as fixed ASCII, not a 3D raster', () => {
    const splash = sisuSplash(80, false)
    expect(splash).toContain('思溯')
    expect(splash).toContain('SISU')
    expect(splash).toMatch(/▄|█|▀/)
    expect(stripAnsi(sisuMarkArt(80, false))).not.toMatch(/NaN/)
    expect(sisuMarkLines(80).length).toBe(sisuMarkHeight(80))
    expect(sisuWordmark()).toMatch(/思/)
    expect(sisuBanner(80, 0, false)).toContain('SISU')
  })

  it('uses a compact mark on narrow terminals', () => {
    expect(sisuMarkLines(40)[0].length).toBeLessThan(sisuMarkLines(80)[0].length)
    expect(sisuMarkLines(40).length).toBeLessThan(sisuMarkLines(80).length)
  })

  it('paints the ribbon with the blue-purple-gold brand gradient', () => {
    const [lr, lg, lb] = markRgb(0, 40)
    const [rr, rg, rb] = markRgb(39, 40)
    expect(lb).toBeGreaterThan(rr)
    expect(rr).toBeGreaterThan(lr)
    const colored = sisuMarkArt(80, true)
    expect(colored).toContain('\x1b[38;2;')
    expect(colored).not.toMatch(/NaN/)
  })
})
