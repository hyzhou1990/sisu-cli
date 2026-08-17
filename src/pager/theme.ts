/** SiSu pager palette: blue → purple → gold. */

export type ThemeName = 'dark' | 'light'

export interface PagerTheme {
  text: (s: string) => string
  dim: (s: string) => string
  accent: (s: string) => string
  error: (s: string) => string
  border: (s: string) => string
  user: (s: string) => string
  tool: (s: string) => string
  reset: string
}

const RESET = '\x1b[0m'

function ansiRgb(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`
}

function paint(prefix: string): (s: string) => string {
  return (s: string) => (s ? `${prefix}${s}${RESET}` : s)
}

const BLUE = ansiRgb(37, 99, 235)
const PURPLE = ansiRgb(124, 58, 237)
const GOLD = ansiRgb(217, 119, 6)

const DARK: PagerTheme = {
  text: paint(ansiRgb(230, 232, 240)),
  dim: paint(ansiRgb(118, 124, 148)),
  accent: paint(GOLD),
  error: paint(ansiRgb(239, 68, 68)),
  border: paint(ansiRgb(72, 64, 96)),
  user: paint(ansiRgb(156, 174, 214)),
  tool: paint(PURPLE),
  reset: RESET,
}

const LIGHT: PagerTheme = {
  text: paint(ansiRgb(24, 28, 40)),
  dim: paint(ansiRgb(100, 108, 128)),
  accent: paint(GOLD),
  error: paint(ansiRgb(185, 28, 28)),
  border: paint(BLUE),
  user: paint(ansiRgb(37, 99, 180)),
  tool: paint(PURPLE),
  reset: RESET,
}

export function getTheme(name: ThemeName = 'dark'): PagerTheme {
  return name === 'light' ? LIGHT : DARK
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return isWide(code) ? 2 : 1
}

/** Terminal cells, not JS string length — CJK is two cells. */
export function visibleWidth(line: string): number {
  let width = 0
  for (const ch of stripAnsi(line)) width += charWidth(ch)
  return width
}

export function clipVisible(line: string, width: number): string {
  if (width <= 0) return ''
  if (visibleWidth(line) <= width) return line
  let seen = 0
  let out = ''
  const re = /\x1b\[[0-9;]*m/g
  let last = 0
  let match = re.exec(line)
  const take = (from: number, to: number) => {
    let i = from
    while (i < to && seen < width) {
      const code = line.charCodeAt(i)
      const wide = code >= 0xd800 && code <= 0xdbff
      const ch = wide ? line.slice(i, i + 2) : line[i]
      const step = charWidth(ch)
      if (seen + step > width) break
      out += ch
      seen += step
      i += ch.length
    }
  }
  while (match) {
    take(last, match.index)
    if (seen >= width) break
    out += match[0]
    last = match.index + match[0].length
    match = re.exec(line)
  }
  take(last, line.length)
  return out + RESET
}

export function padVisible(line: string, cols: number): string {
  const width = Math.max(0, cols)
  if (width === 0) return ''
  const vis = visibleWidth(line)
  if (vis === width) return line
  if (vis > width) return clipVisible(line, width)
  return `${line}${' '.repeat(width - vis)}`
}
