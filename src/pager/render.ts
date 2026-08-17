import { filterSlash, type PagerEntry, type PagerState } from './model'
import { getTheme, stripAnsi, type ThemeName } from './theme'

const PROMPT_PREFIX = '› '
const PROMPT_BOX_ROWS = 2
const STATUS_ROWS = 1
const MARK_WIDTH = 2

/** Pad (and clip reserved chrome) to exactly `cols` cells. */
function pad(line: string, cols: number): string {
  const width = Math.max(0, cols)
  if (width === 0) return ''
  const plain = stripAnsi(line)
  if (plain.length === width) return plain
  if (plain.length > width) return plain.slice(0, width)
  return plain.padEnd(width, ' ')
}

function wrapPlain(text: string, width: number): string[] {
  const max = Math.max(1, width)
  if (!text) return ['']
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      out.push('')
      continue
    }
    for (let i = 0; i < paragraph.length; i += max) {
      out.push(paragraph.slice(i, i + max))
    }
  }
  return out
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

function entryBodyLines(entry: PagerEntry, wrapWidth: number): string[] {
  if (entry.folded) {
    const n = lineCount(entry.text)
    const unit = n === 1 ? 'line' : 'lines'
    return wrapPlain(`${entry.kind} · ${n} ${unit}`, wrapWidth)
  }
  if (!entry.text) return ['']
  return wrapPlain(entry.text, wrapWidth)
}

function layoutScrollback(
  state: PagerState,
  cols: number,
): { lines: string[]; entryOf: number[] } {
  const wrapWidth = Math.max(1, cols - MARK_WIDTH)
  const lines: string[] = []
  const entryOf: number[] = []
  for (let i = 0; i < state.entries.length; i += 1) {
    const entry = state.entries[i]
    const body = entryBodyLines(entry, wrapWidth)
    const mark = i === state.selected && state.entries.length > 0 ? '▸ ' : '  '
    for (let j = 0; j < body.length; j += 1) {
      lines.push(j === 0 ? `${mark}${body[j]}` : `  ${body[j]}`)
      entryOf.push(i)
    }
  }
  return { lines, entryOf }
}

function windowAroundSelected(
  lines: string[],
  entryOf: number[],
  selected: number,
  budget: number,
  lastEntry: number,
): string[] {
  if (budget <= 0) return []
  if (lines.length <= budget) return lines
  if (selected >= lastEntry) return lines.slice(lines.length - budget)

  let start = -1
  let end = -1
  for (let i = 0; i < entryOf.length; i += 1) {
    if (entryOf[i] !== selected) continue
    if (start < 0) start = i
    end = i
  }
  if (start < 0) return lines.slice(lines.length - budget)
  if (end - start + 1 >= budget) return lines.slice(start, start + budget)
  const windowStart = Math.max(0, Math.min(start, end + 1 - budget))
  return lines.slice(windowStart, windowStart + budget)
}

function isIdleWelcome(state: PagerState): boolean {
  return !state.conversationId && state.entries.length === 0
}

function welcomeLines(guest: boolean): string[] {
  if (guest) {
    return [
      'SISU',
      '',
      'Sign in to start a conversation.',
      '/login   open the browser',
      '/help    commands',
    ]
  }
  return [
    'SISU',
    '',
    'Ask anything, or type /help.',
  ]
}

function slashMenuLines(state: PagerState): string[] {
  if (!state.slashOpen) return []
  const items = filterSlash(state.draft)
  return items.map((item, index) => {
    const mark = index === state.slashIndex ? '› ' : '  '
    return `${mark}${item.name}  ${item.hint}`
  })
}

/**
 * Pure fixed-grid frame: always `rows` lines, each exactly `cols` characters.
 * `theme` selects the SiSu palette via `getTheme` for future colored paint; the
 * frame itself is plain so `line.length === cols` for the tty writer.
 * Deterministic: no clock, no I/O.
 */
export function renderPager(
  state: PagerState,
  cols: number,
  rows: number,
  theme: ThemeName = 'dark',
): string {
  // Bind palette so dark/light stays on the public pure path (app may recolor).
  getTheme(theme)

  const height = Math.max(0, rows)
  const width = Math.max(0, cols)
  if (height === 0) return ''

  const promptRows = Math.min(PROMPT_BOX_ROWS, height)
  const statusRows = height > promptRows ? Math.min(STATUS_ROWS, height - promptRows) : 0
  const chrome = promptRows + statusRows
  const bodyBudget = Math.max(0, height - chrome)

  const slash = slashMenuLines(state)
  const slashTake = Math.min(slash.length, bodyBudget)
  const guest = !(state.statusLine || '').trim() || (state.statusLine || '').includes('not signed in')
  const welcome = isIdleWelcome(state) ? welcomeLines(guest).map((line) => (line ? `  ${line}` : '')) : []
  const welcomeTake = Math.min(welcome.length, Math.max(0, bodyBudget - slashTake))
  const scrollBudget = bodyBudget - slashTake - welcomeTake

  const laid = layoutScrollback(state, width)
  const lastEntry = Math.max(0, state.entries.length - 1)
  const visibleScroll = windowAroundSelected(
    laid.lines,
    laid.entryOf,
    state.selected,
    scrollBudget,
    lastEntry,
  )

  const body: string[] = []
  body.push(...welcome.slice(0, welcomeTake))
  // Top-pad remaining scrollback so live status sits just above slash/prompt.
  while (body.length + visibleScroll.length < welcomeTake + scrollBudget) {
    body.push('')
  }
  body.push(...visibleScroll)
  body.push(...slash.slice(0, slashTake))

  const lines: string[] = body.map((line) => pad(line, width))

  if (statusRows > 0) {
    lines.push(pad(state.statusLine ?? '', width))
  }

  if (promptRows >= 2) {
    // Prompt box: border row + draft row (`› {draft}`).
    lines.push(pad('─'.repeat(width), width))
    lines.push(pad(`${PROMPT_PREFIX}${state.draft}`, width))
  } else if (promptRows === 1) {
    lines.push(pad(`${PROMPT_PREFIX}${state.draft}`, width))
  }

  while (lines.length < height) lines.push(pad('', width))
  if (lines.length > height) lines.length = height

  return lines.map((line) => pad(line, width)).join('\n')
}
