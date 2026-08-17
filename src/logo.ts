export { sisuMarkArt, sisuMarkLines } from './mark'
import { sisuMarkArt, sisuMarkLines } from './mark'
import { mobiusFrameHeight, mobiusFrameWidth, renderMobiusFrame } from './mobius'

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

/** Splash used on TUI enter: the web Möbius mark plus 思溯. */
export function sisuSplash(columns = 80, color = true): string {
  const mark = sisuMarkArt(columns, color)
  const markWidth = sisuMarkLines(columns)[0]?.length ?? 0
  const caption = '思溯   SISU'
  const pad = Math.max(0, Math.floor((markWidth - caption.length) / 2))
  return ['', mark, '', `${' '.repeat(pad)}${caption}`, ''].join('\n')
}

export function sisuBanner(columns = 80, _phase = 0, color = false): string {
  return sisuSplash(columns, color)
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
