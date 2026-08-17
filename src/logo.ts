export { sisuMarkArt, sisuMarkLines } from './mark'
export { sisuTreeArt, sisuTreeLines } from './tree'
import { markRgb } from './mark'
import { mobiusFrameHeight, mobiusFrameWidth, renderMobiusFrame } from './mobius'
import { sisuTreeArt, sisuTreeLines } from './tree'

const RESET = '\x1b[0m'
const TERRACOTTA = '\x1b[38;2;184;90;58m'
const INK = '\x1b[38;2;220;214;204m'
const INK_DIM = '\x1b[38;2;140;132;120m'

const HEADLINE = '思有所溯'
const TAGLINE = '为科研而生的工作台——记录退到思考之后，不打扰任何一念。'
const COLOPHON = [
  '对话、文献与数据，落笔成档',
  '每个结论，都能沿枝回到它的根',
  '众人的知识彼此嫁接，长成一片林',
]
const NUMERALS = ['一', '二', '三']

export function sisuMobiusArt(columns = 80, phase = 0, color = false): string {
  return renderMobiusFrame({
    cols: mobiusFrameWidth(columns),
    rows: mobiusFrameHeight(columns),
    phase,
    color,
  })
}

export function sisuWordmark(): string {
  return ['思溯', 'SISU'].join('\n')
}

/** Terminal cells, not JS string length — CJK and ∞ must sit on the grid. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of stripAnsi(text)) {
    const code = ch.codePointAt(0) ?? 0
    width += isWide(code) ? 2 : 1
  }
  return width
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

function paint(text: string, prefix: string, color: boolean): string {
  if (!color || !text) return text
  return `${prefix}${text}${RESET}`
}

function infinityMark(color: boolean): string {
  if (!color) return '∞'
  const [r, g, b] = markRgb(0, 2)
  return `\x1b[38;2;${r};${g};${b}m∞${RESET}`
}

function lockup(color: boolean): string[] {
  const inf = infinityMark(color)
  const name = paint('思溯', INK, color)
  const latin = paint('SiSu', INK_DIM, color)
  return [`${inf}  ${name}`, `   ${latin}`]
}

function colophon(columns: number, color: boolean): string[] {
  const lines: string[] = []
  for (let i = 0; i < COLOPHON.length; i += 1) {
    const num = paint(NUMERALS[i], TERRACOTTA, color)
    const body = paint(COLOPHON[i], INK_DIM, color)
    const line = `${num}  ${body}`
    if (displayWidth(line) + 2 <= columns) lines.push(line)
  }
  return lines
}

function padLeft(text: string, n: number): string {
  return `${' '.repeat(Math.max(0, n))}${text}`
}

function center(text: string, width: number): string {
  const vis = displayWidth(text)
  const pad = Math.max(0, Math.floor((width - vis) / 2))
  return padLeft(text, pad)
}

function copyColumn(columns: number, color: boolean, compact: boolean): string[] {
  const indent = 2
  const lines = [
    ...lockup(color).map((line) => padLeft(line, indent)),
    '',
    padLeft(paint(HEADLINE, INK, color), indent),
  ]
  if (!compact && displayWidth(TAGLINE) + indent <= columns) {
    lines.push(padLeft(paint(TAGLINE, INK_DIM, color), indent))
  }
  if (!compact) {
    const notes = colophon(columns, color)
    if (notes.length) {
      lines.push('')
      for (const note of notes) lines.push(padLeft(note, indent))
    }
  }
  return lines
}

function treeColumn(columns: number, color: boolean): string[] {
  const raw = sisuTreeLines(columns)
  const painted = sisuTreeArt(columns, color).split('\n')
  const treeWidth = raw.reduce((max, line) => Math.max(max, line.length), 0)
  const pad = Math.max(0, Math.floor((columns - treeWidth) / 2))
  return painted.map((line, i) => {
    const vis = raw[i]?.length ?? displayWidth(line)
    return padLeft(`${line}${' '.repeat(Math.max(0, treeWidth - vis))}`, pad)
  })
}

/**
 * Login-page splash: lockup + 思有所溯 + 题跋 over the 溯源之树.
 * Side-by-side on a wide terminal; stacked when the sheet is narrow.
 */
export function sisuSplash(columns = 80, color = true): string {
  const width = Math.max(20, Math.floor(columns))
  const compact = width < 52
  const copy = copyColumn(width, color, compact)
  const tree = treeColumn(width, color)
  if (width >= 100) {
    const gap = 3
    const leftW = Math.max(...copy.map((line) => displayWidth(line)))
    const rightW = width - leftW - gap
    const right = treeColumn(rightW, color)
    const rows = Math.max(copy.length, right.length)
    const merged: string[] = ['']
    for (let i = 0; i < rows; i += 1) {
      const left = copy[i] ?? ''
      const pad = Math.max(0, leftW + gap - displayWidth(left))
      merged.push(`${left}${' '.repeat(pad)}${right[i] ?? ''}`)
    }
    merged.push('')
    return merged.join('\n')
  }
  return ['', ...copy, '', ...tree, ''].join('\n')
}

export function sisuWelcomeCopy(guest: boolean, color = true): string[] {
  const lines = [
    ...lockup(color),
    paint(HEADLINE, INK, color),
  ]
  if (guest) {
    lines.push(paint('Sign in to start a conversation.', INK_DIM, color))
    lines.push(paint('/login  browser    /help  commands', INK_DIM, color))
  } else {
    lines.push(paint('Ask anything, or type /help.', INK_DIM, color))
  }
  return lines
}

export function sisuBanner(columns = 80, _phase = 0, color = false): string {
  return sisuSplash(columns, color)
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
