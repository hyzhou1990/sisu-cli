import { sisuBanner, sisuMobiusArt, sisuWordmark, stripAnsi } from './logo'

describe('sisu logo', () => {
  it('renders a Möbius ring frame and the 思溯 wordmark', () => {
    const banner = sisuBanner(80)
    expect(banner).toContain('思溯')
    expect(banner).toContain('SISU')
    expect(stripAnsi(sisuMobiusArt(80)).split('\n').length).toBeGreaterThanOrEqual(10)
    expect(stripAnsi(sisuMobiusArt(80)).replace(/ /g, '').length).toBeGreaterThan(40)
    expect(sisuWordmark()).toMatch(/思/)
  })

  it('uses a smaller grid on narrow terminals', () => {
    expect(sisuMobiusArt(40).split('\n').length).toBeLessThan(sisuMobiusArt(80).split('\n').length)
  })
})
