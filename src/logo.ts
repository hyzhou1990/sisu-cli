export { sisuMarkArt, sisuMarkLines } from './mark'
export { sisuTreeArt, sisuTreeLines } from './tree'
import { markRgb } from './mark'
import { mobiusFrameHeight, mobiusFrameWidth, renderMobiusFrame } from './mobius'
import { visibleWidth } from './pager/theme'

const RESET = '\x1b[0m'
const INK = '\x1b[38;2;220;214;204m'
const INK_DIM = '\x1b[38;2;140;132;120m'

export const SISU_BRAND = {
  zh: '思溯',
  en: 'SiSu',
  headline: '思有所溯',
} as const

const HEADLINE = SISU_BRAND.headline

export function sisuMobiusArt(columns = 80, phase = 0, color = false): string {
  return renderMobiusFrame({
    cols: mobiusFrameWidth(columns),
    rows: mobiusFrameHeight(columns),
    phase,
    color,
  })
}

export function sisuWordmark(): string {
  return [SISU_BRAND.zh, SISU_BRAND.en.toUpperCase()].join('\n')
}

/** First-surface copy: splash, welcome, help, about. */
export function sisuProductSurfaces(): { splash: string; welcome: string; helpAbout: string } {
  return {
    splash: stripAnsi(sisuSplash(72, false)),
    welcome: sisuWelcomeCopy(false, false).join('\n'),
    helpAbout: `sisu — ${SISU_BRAND.en} · ${SISU_BRAND.zh} · ${SISU_BRAND.headline}`,
  }
}

export function displayWidth(text: string): number {
  return visibleWidth(text)
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
  return [`${inf}  ${name}`, latin]
}

function padLeft(text: string, n: number): string {
  return `${' '.repeat(Math.max(0, n))}${text}`
}

function center(text: string, width: number): string {
  const vis = displayWidth(text)
  const pad = Math.max(0, Math.floor((width - vis) / 2))
  return padLeft(text, pad)
}

function centerBlock(lines: string[], width: number): string[] {
  return lines.map((line) => center(line, width))
}

export const SISU_STILL_PHASE = 0.85
const STILL_PHASE = SISU_STILL_PHASE

/**
 * Möbius splash. `phase` slides the half-twist around the single face.
 * Line count is stable for a given width so the intro can rewrite in place.
 */
export function sisuSplashFrame(columns = 80, color = true, phase = STILL_PHASE, _grow = 1): string {
  const width = Math.max(20, Math.floor(columns))
  const ringW = mobiusFrameWidth(width)
  const ring = renderMobiusFrame({
    cols: ringW,
    rows: mobiusFrameHeight(width),
    phase,
    color,
  }).split('\n')
  const pad = Math.max(0, Math.floor((width - ringW) / 2))
  const art = ring.map((line) => padLeft(line, pad))
  const caption = centerBlock(
    [
      `${infinityMark(color)}  ${paint('思溯', INK, color)}   ${paint('SiSu', INK_DIM, color)}`,
      paint(HEADLINE, INK, color),
    ],
    width,
  )
  return [...art, '', ...caption].join('\n')
}

export function sisuSplashHeight(columns = 80): number {
  return sisuSplashFrame(columns, false).split('\n').length
}

export function sisuSplash(columns = 80, color = true): string {
  return sisuSplashFrame(columns, color, STILL_PHASE, 1)
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

export function sisuBanner(columns = 80, phase = STILL_PHASE, color = false): string {
  return sisuSplashFrame(columns, color, phase, 1)
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
