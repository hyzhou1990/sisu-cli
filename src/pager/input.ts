import type { PagerKey } from './model'

/**
 * Decode a raw terminal input chunk into pager keys.
 * Incomplete CSI/SS3 sequences are returned in `rest` so the next read can finish them.
 * `\x03` (Ctrl+C) maps to escape; the app treats escape at empty draft as quit.
 */
export function decodeKeys(chunk: string): { keys: PagerKey[]; rest: string } {
  const keys: PagerKey[] = []
  let i = 0

  while (i < chunk.length) {
    const ch = chunk[i]

    if (ch === '\x1b') {
      if (i + 1 === chunk.length) {
        keys.push({ type: 'escape' })
        i += 1
        continue
      }
      if (chunk[i + 1] === 'O') {
        if (i + 2 >= chunk.length) return { keys, rest: chunk.slice(i) }
        const arrow = arrowFrom(chunk[i + 2])
        if (arrow) {
          keys.push({ type: arrow })
          i += 3
          continue
        }
        keys.push({ type: 'escape' })
        i += 1
        continue
      }
      if (chunk[i + 1] === '[') {
        let j = i + 2
        while (j < chunk.length && /[0-9;]/.test(chunk[j])) j += 1
        if (j >= chunk.length) return { keys, rest: chunk.slice(i) }
        const body = chunk.slice(i + 2, j)
        const term = chunk[j]
        const arrow = arrowFrom(term)
        if (arrow) {
          keys.push({ type: arrow })
          i = j + 1
          continue
        }
        if (term === '~' && body === '5') {
          keys.push({ type: 'pageup' })
          i = j + 1
          continue
        }
        if (term === '~' && body === '6') {
          keys.push({ type: 'pagedown' })
          i = j + 1
          continue
        }
        keys.push({ type: 'escape' })
        i += 1
        continue
      }
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

    if (ch === '\x03') {
      keys.push({ type: 'escape' })
      i += 1
      continue
    }

    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) {
      i += 1
      continue
    }

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

function arrowFrom(code: string): 'up' | 'down' | 'right' | 'left' | null {
  if (code === 'A') return 'up'
  if (code === 'B') return 'down'
  if (code === 'C') return 'right'
  if (code === 'D') return 'left'
  return null
}
