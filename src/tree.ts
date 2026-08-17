/** 溯源之树 — hand-inked ASCII of the login welcome painting. */

const RESET = '\x1b[0m'

const INK: [number, number, number] = [196, 186, 170]
const INK_DIM: [number, number, number] = [130, 120, 108]
const FRUIT: [number, number, number] = [184, 90, 58]
const HILL: [number, number, number] = [90, 82, 70]

/**
 * Desktop login tree. Trunk sits near center; crown opens into an airy
 * fan with terracotta tips — the same 图景 as BrandCanvas, not a Möbius.
 */
const TREE_WIDE = [
  '                      •    •      •  •      •    •     •',
  '                 •  •    •    •     •   •    •     •  •   •',
  '              •     •  •   •   •  •    •  •    •  •    •   •',
  '           •     •    ╲  •   ╲  •   ╱ •   ╲   •    •    •',
  '         •      ╲    ╱ ╲    ╲    ╱ ╲     ╱ ╲   ╲    ╲  ╱',
  '        •        ╲  ╱   ╲    ╲  ╱   ╲   ╱   ╲   ╲    ╲╱',
  '         ╲        ╲╱     ╲    ╲╱     ╲ ╱     ╲   ╲    ╱',
  '          ╲       ╱       ╲   ╱       Y       ╲   ╲  ╱',
  '           ╲     ╱         ╲ ╱       ╱         ╲   ╲╱',
  '            ╲   ╱           Y       ╱           ╲  ╱',
  '             ╲ ╱           ╱ ╲     ╱             ╲╱',
  '              Y           ╱   ╲   ╱              ╱',
  '              │          ╱     ╲ ╱',
  '              │         ╱       Y',
  '              │        ╱',
  '              │',
  '▁▁▁▂▂▁▁▁▁▁▁▁▁▁│▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
]

const TREE_MID = [
  '                •   •    •  •    •   •   •',
  '            •  •   •  •    •   •   •    •  •',
  '         •    •  ╲  •  ╲ •   ╱ •  ╲   •   •',
  '       •    ╲   ╱ ╲   ╲   ╱ ╲    ╱ ╲   ╲ ╱',
  '        ╲    ╲ ╱   ╲   ╲ ╱   ╲  ╱   ╲   Y',
  '         ╲    Y     ╲   Y     ╲╱     ╲ ╱',
  '          ╲  ╱       ╲ ╱      ╱       Y',
  '           ╲╱         Y      ╱       ╱',
  '           │         ╱ ╲    ╱',
  '           │        ╱   ╲  ╱',
  '           │       ╱     ╲╱',
  '           │',
  '▁▁▂▂▁▁▁▁▁▁▁│▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
]

const TREE_NARROW = [
  '          •  •   •  •  •',
  '       •   ╲ • ╱ •  ╲  •',
  '      ╲   ╱ ╲ ╱ ╲  ╱ ╲╱',
  '       ╲ ╱   Y   ╲╱   ╱',
  '        Y   ╱     ╲  ╱',
  '        │  ╱       ╲╱',
  '        │',
  '▁▁▁▁▁▁▁▁│▁▁▁▁▁▁▁▁▁▁▁▁▁▁',
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function paintRgb(ch: string, rgb: [number, number, number]): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${ch}`
}

function inkAt(x: number, width: number): [number, number, number] {
  const t = width <= 1 ? 0 : x / (width - 1)
  return [
    Math.round(lerp(INK[0], INK_DIM[0], t * 0.45)),
    Math.round(lerp(INK[1], INK_DIM[1], t * 0.45)),
    Math.round(lerp(INK[2], INK_DIM[2], t * 0.45)),
  ]
}

function paintLine(line: string, color: boolean): string {
  if (!color) return line
  let out = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === ' ') {
      out += ' '
      continue
    }
    if (ch === '•') {
      out += paintRgb(ch, FRUIT)
      continue
    }
    if (ch === '▁' || ch === '▂') {
      out += paintRgb(ch, HILL)
      continue
    }
    out += paintRgb(ch, inkAt(i, line.length))
  }
  return `${out}${RESET}`
}

function padBlock(lines: string[]): string[] {
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0)
  return lines.map((line) => line.padEnd(width, ' '))
}

export function sisuTreeLines(columns = 80): string[] {
  if (columns >= 68) return padBlock(TREE_WIDE)
  if (columns >= 44) return padBlock(TREE_MID)
  return padBlock(TREE_NARROW)
}

export function sisuTreeArt(columns = 80, color = true): string {
  return sisuTreeLines(columns).map((line) => paintLine(line, color)).join('\n')
}

export function sisuTreeWidth(columns = 80): number {
  return sisuTreeLines(columns).reduce((max, line) => Math.max(max, line.length), 0)
}

export function sisuTreeHeight(columns = 80): number {
  return sisuTreeLines(columns).length
}
