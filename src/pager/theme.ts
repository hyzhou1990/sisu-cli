/** SiSu pager palette: blue → purple → gold (same anchors as mobiusRgb). */

export type ThemeName = 'dark' | 'light'

export interface PagerTheme {
  /** Wrap text in the primary foreground color. */
  text: (s: string) => string
  /** Muted secondary text. */
  dim: (s: string) => string
  /** Brand accent (gold). */
  accent: (s: string) => string
  /** Error / alert (red). */
  error: (s: string) => string
  /** Borders and chrome (blue/purple). */
  border: (s: string) => string
  reset: string
}

const RESET = '\x1b[0m'

function ansiRgb(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`
}

function paint(prefix: string): (s: string) => string {
  return (s: string) => (s ? `${prefix}${s}${RESET}` : s)
}

/** Brand anchors from mobiusRgb (blue, purple, gold). */
const BLUE = ansiRgb(37, 99, 235)
const PURPLE = ansiRgb(124, 58, 237)
const GOLD = ansiRgb(217, 119, 6)

const DARK: PagerTheme = {
  text: paint(ansiRgb(230, 232, 240)),
  dim: paint(ansiRgb(120, 126, 150)),
  accent: paint(GOLD),
  error: paint(ansiRgb(239, 68, 68)),
  border: paint(PURPLE),
  reset: RESET,
}

const LIGHT: PagerTheme = {
  text: paint(ansiRgb(24, 28, 40)),
  dim: paint(ansiRgb(100, 108, 128)),
  accent: paint(GOLD),
  error: paint(ansiRgb(185, 28, 28)),
  border: paint(BLUE),
  reset: RESET,
}

export function getTheme(name: ThemeName = 'dark'): PagerTheme {
  return name === 'light' ? LIGHT : DARK
}

/** Strip 24-bit / SGR sequences for visible-width measurement. */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}
