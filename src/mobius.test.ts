import { mobiusPoint, mobiusRgb, renderMobiusFrame } from './mobius'

function visibleCells(frame: string): number {
  return frame.replace(/\x1b\[[0-9;]*m/g, '').replace(/ /g, '').replace(/\n/g, '').length
}

function centerEmptiness(frame: string): { center: number; ring: number } {
  const lines = frame.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  const mid = Math.floor(lines.length / 2)
  const width = lines[mid]?.length ?? 0
  const slice = (row: string, from: number, to: number) =>
    (row.slice(from, to).match(/[^ ]/g) || []).length
  return {
    center: slice(lines[mid] || '', Math.floor(width * 0.4), Math.floor(width * 0.6)),
    ring: slice(lines[mid] || '', Math.floor(width * 0.05), Math.floor(width * 0.25)),
  }
}

describe('möbius ring', () => {
  it('uses a half-twist: after one full loop the width flips', () => {
    const [, , z0] = mobiusPoint(0, 1)
    const [, , zTurn] = mobiusPoint(Math.PI * 2, 1)
    const [, , zHalf] = mobiusPoint(Math.PI, 1)
    expect(z0).toBeCloseTo(0, 5)
    expect(zTurn).toBeCloseTo(0, 5)
    expect(Math.abs(zHalf)).toBeGreaterThan(0.3)
    const [x0] = mobiusPoint(0, 1)
    const [xFlip] = mobiusPoint(Math.PI * 2, -1)
    expect(x0).toBeCloseTo(xFlip, 5)
  })

  it('rotates: two phases are different frames of the same ring', () => {
    const a = renderMobiusFrame({ cols: 56, rows: 14, phase: 0, color: false })
    const b = renderMobiusFrame({ cols: 56, rows: 14, phase: 0.7, color: false })
    expect(a).not.toEqual(b)
    expect(visibleCells(a)).toBeGreaterThan(40)
    expect(visibleCells(b)).toBeGreaterThan(40)
    const hole = centerEmptiness(a)
    expect(hole.center).toBeLessThan(hole.ring)
  })

  it('keeps the ring hole open as the half-twist travels', () => {
    for (const phase of [0, 1.2, 2.4, 3.8, 5.1]) {
      const hole = centerEmptiness(renderMobiusFrame({ cols: 64, rows: 18, phase, color: false }))
      expect(hole.center).toBeLessThan(hole.ring)
      expect(hole.ring).toBeGreaterThan(2)
    }
  })

  it('shades the band so the twist reads as a volume, not a silhouette', () => {
    const frame = renderMobiusFrame({ cols: 60, rows: 18, phase: 0.5, color: false })
    const marks = frame.replace(/ /g, '').replace(/\n/g, '')
    const bright = (marks.match(/[@%#]/g) || []).length
    const dim = (marks.match(/[.:-]/g) || []).length
    expect(bright).toBeGreaterThan(8)
    expect(dim).toBeGreaterThan(8)
    expect(new Set(marks.split('')).size).toBeGreaterThan(4)
  })

  it('paints the brand blue–purple–gold along the band', () => {
    expect(mobiusRgb(0)[2]).toBeGreaterThan(180)
    expect(mobiusRgb(Math.PI)[0]).toBeGreaterThan(100)
    expect(mobiusRgb(Math.PI * 2 * 0.99)[0]).toBeGreaterThan(180)
    const colored = renderMobiusFrame({ cols: 48, rows: 12, phase: 0.2, color: true })
    expect(colored).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/)
  })
})
