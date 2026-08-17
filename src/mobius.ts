/** Volumetric Möbius ring: half-twist ribbon with thickness, perspective, and lighting. */

const RESET = '\x1b[0m'
const SHADE_RAMP = ' .:-=+*#%@'
const RADIUS = 1.88
const HALF_WIDTH = 0.34
const THICKNESS = 0.08
const CELL_ASPECT = 0.5
const CAM = 8.6
const FOCAL = 5.1
const KEY = norm([-0.58, 0.78, 0.24])
const FILL = norm([0.48, 0.12, 0.86])
const VIEW = [0, 0.12, 1] as const

export interface MobiusFrameOptions {
  cols?: number
  rows?: number
  phase?: number
  color?: boolean
}

interface Cell {
  z: number
  shade: number
  t: number
  spec: number
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function norm(v: number[]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot(a: number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Brand gradient along the band: blue → purple → gold, matching sisu-mark. */
export function mobiusRgb(t: number): [number, number, number] {
  const u = ((t / (Math.PI * 2)) % 1 + 1) % 1
  if (u < 0.5) {
    const k = u / 0.5
    return [
      Math.round(lerp(37, 124, k)),
      Math.round(lerp(99, 58, k)),
      Math.round(lerp(235, 237, k)),
    ]
  }
  const k = (u - 0.5) / 0.5
  return [
    Math.round(lerp(124, 217, k)),
    Math.round(lerp(58, 119, k)),
    Math.round(lerp(237, 6, k)),
  ]
}

function ansiRgb(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`
}

function rotateX(y: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [y * c - z * s, y * s + z * c]
}

function rotateY(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c + z * s, -x * s + z * c]
}

function rotateZ(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c - y * s, x * s + y * c]
}

function transform(x: number, y: number, z: number, tilt: number, spin: number): [number, number, number] {
  // Spin around the ring axis so the half-twist travels; then a fixed 3/4 view.
  ;[x, y] = rotateZ(x, y, spin)
  ;[y, z] = rotateX(y, z, tilt)
  ;[x, z] = rotateY(x, z, 0.32)
  return [x, y, z]
}

/**
 * Standard Möbius strip: a ring of radius R with a half-twist in the width.
 * After one full trip around θ, the normal flips — one-sided surface.
 */
export function mobiusPoint(theta: number, width: number, radius = RADIUS, halfWidth = HALF_WIDTH): [number, number, number] {
  const twist = theta / 2
  const ring = radius + width * halfWidth * Math.cos(twist)
  return [
    ring * Math.cos(theta),
    ring * Math.sin(theta),
    width * halfWidth * Math.sin(twist),
  ]
}

function mobiusNormal(theta: number, width: number, radius = RADIUS, halfWidth = HALF_WIDTH): [number, number, number] {
  const twist = theta / 2
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const c2 = Math.cos(twist)
  const s2 = Math.sin(twist)
  const ring = radius + width * halfWidth * c2
  const dTheta = [
    -ring * s - width * halfWidth * 0.5 * s2 * c,
    ring * c - width * halfWidth * 0.5 * s2 * s,
    width * halfWidth * 0.5 * c2,
  ]
  const dWidth = [
    halfWidth * c2 * c,
    halfWidth * c2 * s,
    halfWidth * s2,
  ]
  return norm(cross(dTheta, dWidth))
}

function shadeChar(shade: number): string {
  return SHADE_RAMP[Math.round(clamp(shade, 0, 1) * (SHADE_RAMP.length - 1))] || '@'
}

export function renderMobiusFrame(options: MobiusFrameOptions = {}): string {
  const cols = Math.max(28, options.cols ?? 64)
  const rows = Math.max(10, options.rows ?? 16)
  const phase = options.phase ?? 0
  const color = options.color !== false
  const grid: Array<Array<Cell | null>> = Array.from({ length: rows }, () => Array(cols).fill(null))
  const tilt = 0.88

  const samples: Array<{
    px: number
    py: number
    depth: number
    shade: number
    spec: number
    t: number
  }> = []

  const thetaSteps = 580
  for (let i = 0; i < thetaSteps; i += 1) {
    const theta = (i / thetaSteps) * Math.PI * 2
    for (let j = -4; j <= 4; j += 1) {
      const width = j / 4
      const base = mobiusPoint(theta, width)
      const n0 = mobiusNormal(theta, width)
      // Faces of the thin solid, plus the mid-surface; skip the interior fill.
      const thicks = j === -4 || j === 4 ? [-1, 0, 1] : [-1, 1]
      for (const k of thicks) {
        const thick = k
        let x = base[0] + n0[0] * thick * THICKNESS
        let y = base[1] + n0[1] * thick * THICKNESS
        let z = base[2] + n0[2] * thick * THICKNESS
        let nx = n0[0]
        let ny = n0[1]
        let nz = n0[2]
        if (thick < 0) {
          nx = -nx
          ny = -ny
          nz = -nz
        }
        ;[x, y, z] = transform(x, y, z, tilt, phase)
        ;[nx, ny, nz] = transform(nx, ny, nz, tilt, phase)
        let normal: [number, number, number] = [nx, ny, nz]
        const facing = dot(normal, VIEW)
        const back = facing < 0
        if (back) normal = [-normal[0], -normal[1], -normal[2]]

        const depth = CAM - z
        if (depth < 0.35) continue
        const px = (x * FOCAL) / depth
        const py = (y * FOCAL) / depth

        const lambert = Math.max(0, dot(normal, KEY))
        const fill = Math.max(0, dot(normal, FILL)) * 0.2
        const camFill = Math.max(0, dot(normal, VIEW)) * 0.22
        const half = norm([KEY[0] + VIEW[0], KEY[1] + VIEW[1], KEY[2] + VIEW[2]])
        const spec = Math.pow(Math.max(0, dot(normal, half)), 28)
        const edge = Math.max(Math.abs(width), Math.abs(thick))
        const rim = Math.pow(1 - Math.abs(dot(normal, VIEW)), 2.2) * (0.1 + 0.5 * Math.pow(edge, 2))
        const ambient = back ? 0.09 : 0.18
        const lit = ambient + lambert * (back ? 0.3 : 0.74) + fill + camFill + spec * 0.5 + rim
        const shade = clamp(Math.pow(lit, 1.2), 0.07, 1)
        samples.push({
          px,
          py,
          depth,
          shade,
          spec,
          t: theta + (back ? Math.PI : 0),
        })
      }
    }
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minD = Infinity
  let maxD = -Infinity
  for (const sample of samples) {
    const sx = sample.px
    const sy = sample.py * CELL_ASPECT
    if (sx < minX) minX = sx
    if (sx > maxX) maxX = sx
    if (sy < minY) minY = sy
    if (sy > maxY) maxY = sy
    if (sample.depth < minD) minD = sample.depth
    if (sample.depth > maxD) maxD = sample.depth
  }
  const spanX = Math.max(0.001, maxX - minX)
  const spanY = Math.max(0.001, maxY - minY)
  const scale = Math.min((cols - 4) / spanX, (rows - 2) / spanY)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const depthSpan = Math.max(0.001, maxD - minD)

  for (const sample of samples) {
    const fog = 0.4 + 0.6 * (1 - (sample.depth - minD) / depthSpan)
    const col = Math.round((sample.px - midX) * scale + (cols - 1) / 2)
    const row = Math.round(-((sample.py * CELL_ASPECT) - midY) * scale + (rows - 1) / 2)
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue
    const prev = grid[row][col]
    if (!prev || sample.depth < prev.z) {
      grid[row][col] = {
        z: sample.depth,
        shade: clamp(sample.shade * fog, 0.06, 1),
        t: sample.t,
        spec: sample.spec * fog,
      }
    }
  }

  return grid.map((line) => line.map((cell) => {
    if (!cell) return ' '
    const ch = shadeChar(cell.shade)
    if (!color) return ch
    let [r, g, b] = mobiusRgb(cell.t)
    const lift = 0.18 + cell.shade * 0.95 + cell.spec * 0.7
    r = clamp(Number.isFinite(r * lift) ? Math.round(r * lift) : 180, 0, 255)
    g = clamp(Number.isFinite(g * lift) ? Math.round(g * lift) : 180, 0, 255)
    b = clamp(Number.isFinite(b * lift) ? Math.round(b * lift) : 180, 0, 255)
    return `${ansiRgb(r, g, b)}${ch}${RESET}`
  }).join('')).join('\n')
}

export function mobiusFrameHeight(columns = 80): number {
  return columns < 56 ? 13 : 20
}

export function mobiusFrameWidth(columns = 80): number {
  return columns < 56 ? 44 : Math.min(76, Math.max(56, columns - 4))
}
