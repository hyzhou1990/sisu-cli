import { sisuTreeArt, sisuTreeHeight, sisuTreeLines, sisuTreeWidth } from './tree'

it('keeps every row the same width so the trunk stays vertical', () => {
  for (const cols of [80, 50, 30]) {
    const lines = sisuTreeLines(cols)
    const width = lines[0].length
    expect(lines.every((line) => line.length === width)).toBe(true)
    const trunks = lines.map((line) => line.indexOf('│')).filter((i) => i >= 0)
    expect(new Set(trunks).size).toBe(1)
  }
})

it('draws a branching tree with terracotta tips and a trunk', () => {
  const lines = sisuTreeLines(80)
  const art = lines.join('\n')
  expect(art).toContain('│')
  expect(art).toContain('╱')
  expect(art).toContain('╲')
  expect(art).toContain('•')
  expect(art).toMatch(/▁|▂/)
  expect(lines.length).toBe(sisuTreeHeight(80))
  expect(sisuTreeWidth(80)).toBeGreaterThan(sisuTreeWidth(40))
  expect(sisuTreeArt(80, true)).toContain('\x1b[38;2;184;90;58m')
  expect(sisuTreeArt(80, true)).not.toMatch(/NaN/)
})
