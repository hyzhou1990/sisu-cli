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
  return [
    '                      思   溯',
    '                      S I S U',
  ].join('\n')
}

export function sisuBanner(columns = 80, phase = 0, color = false): string {
  return [
    '',
    sisuMobiusArt(columns, phase, color),
    '',
    sisuWordmark(),
    '',
  ].join('\n')
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
