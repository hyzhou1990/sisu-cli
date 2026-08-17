import type { PagerKey } from './model'

/**
 * Decode a raw terminal input chunk into pager keys.
 * Incomplete CSI sequences are returned in `rest` so the next read can finish them.
 * `\x03` (Ctrl+C) maps to escape; the app treats escape at empty draft as quit.
 */
export function decodeKeys(chunk: string): { keys: PagerKey[]; rest: string } {
  const keys: PagerKey[] = []
  let i = 0

  while (i < chunk.length) {
    const ch = chunk[i]

    if (ch === '\x1b') {
      // Incomplete CSI prefix — hold for the next chunk.
      if (i + 1 === chunk.length) {
        keys.push({ type: 'escape' })
        i += 1
        continue
      }
      if (chunk[i + 1] === '[') {
        if (i + 2 >= chunk.length) {
          return { keys, rest: chunk.slice(i) }
        }
        const code = chunk[i + 2]
        const arrow =
          code === 'A'
            ? 'up'
            : code === 'B'
              ? 'down'
              : code === 'C'
                ? 'right'
                : code === 'D'
                  ? 'left'
                  : null
        if (arrow) {
          keys.push({ type: arrow })
          i += 3
          continue
        }
        // Unknown completed CSI: treat ESC as escape and rescan from '['.
        keys.push({ type: 'escape' })
        i += 1
        continue
      }
      // ESC not introducing CSI → escape
      keys.push({ type: 'escape' })
      i += 1
      continue
    }

    if (ch === '\r' || ch === '\n') {
      keys.push({ type: 'enter' })
      i += 1
      continue
    }

    if (ch === '\x7f' || ch === '\b') {
      keys.push({ type: 'backspace' })
      i += 1
      continue
    }

    // Ctrl+C → escape (app treats escape at empty draft as quit)
    if (ch === '\x03') {
      keys.push({ type: 'escape' })
      i += 1
      continue
    }

    // Skip other C0 controls (except those handled above)
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) {
      i += 1
      continue
    }

    // Printable UTF-16 code unit / surrogate pair as one char
    const cp = chunk.codePointAt(i)
    if (cp === undefined) {
      i += 1
      continue
    }
    const value = String.fromCodePoint(cp)
    keys.push({ type: 'char', value })
    i += value.length
  }

  return { keys, rest: '' }
}
