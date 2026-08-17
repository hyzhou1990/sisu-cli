import { displayWidth, SISU_STILL_PHASE, sisuMobiusArt, sisuWelcomeCopy } from '../logo'
import { mobiusFrameHeight, mobiusFrameWidth } from '../mobius'
import { filterSlash, type PagerEntry, type PagerState } from './model'
import { getTheme, padVisible, stripAnsi, type PagerTheme, type ThemeName } from './theme'

const PROMPT_PREFIX = '› '
const PROMPT_BOX_ROWS = 2
const STATUS_ROWS = 1
const MARK_WIDTH = 2

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

function paintKind(kind: PagerEntry['kind'], body: string, theme: PagerTheme): string {
  if (!body) return body
  if (kind === 'user') return theme.user(body)
  if (kind === 'tool') return theme.tool(body)
  if (kind === 'status') return theme.dim(body)
  return theme.text(body)
}

function entryPrefix(kind: PagerEntry['kind']): string {
  if (kind === 'user') return 'you  '
  if (kind === 'tool') return 'tool '
  return ''
}

function entryBodyLines(entry: PagerEntry, wrapWidth: number): string[] {
  if (entry.folded) {
    const n = lineCount(entry.text)
    const unit = n === 1 ? 'line' : 'lines'
    return wrapPlain(`${entry.kind} · ${n} ${unit}`, wrapWidth)
  }
  if (!entry.text) return ['']
  return wrapPlain(`${entryPrefix(entry.kind)}${entry.text}`, wrapWidth)
}

function layoutScrollback(
  state: PagerState,
  cols: number,
  theme: PagerTheme,
): { lines: string[]; entryOf: number[] } {
  const wrapWidth = Math.max(1, cols - MARK_WIDTH)
  const lines: string[] = []
  const entryOf: number[] = []
  for (let i = 0; i < state.entries.length; i += 1) {
    const entry = state.entries[i]
    const body = entryBodyLines(entry, wrapWidth)
    const selected = i === state.selected && state.entries.length > 0
    for (let j = 0; j < body.length; j += 1) {
      const mark = selected && j === 0 ? theme.accent('▸ ') : '  '
      lines.push(`${mark}${paintKind(entry.kind, body[j], theme)}`)
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

function center(text: string, width: number, vis = displayWidth(text)): string {
  const padLeft = Math.max(0, Math.floor((width - vis) / 2))
  return `${' '.repeat(padLeft)}${text}`
}

function welcomeLines(
  guest: boolean,
  width: number,
  bodyBudget: number,
  phase: number,
): string[] {
  const copy = sisuWelcomeCopy(guest, true).map((line) => center(line, width))
  const ringRoom = Math.max(0, bodyBudget - copy.length - 1)
  if (ringRoom < 4 || width < 28) return copy
  const ringW = mobiusFrameWidth(width >= 48 ? Math.min(width, 72) : Math.min(width, 44))
  const ringH = Math.min(mobiusFrameHeight(ringW), ringRoom)
  const painted = sisuMobiusArt(ringW, phase, true).split('\n').slice(0, ringH)
  const pad = Math.max(0, Math.floor((width - ringW) / 2))
  const ring = painted.map((line) => `${' '.repeat(pad)}${line}`)
  if (bodyBudget >= 16) return [...ring, '', ...copy]
  return [...copy, '', ...ring]
}

function slashMenuLines(state: PagerState, theme: PagerTheme): string[] {
  if (!state.slashOpen) return []
  const items = filterSlash(state.draft)
  return items.map((item, index) => {
    const active = index === state.slashIndex
    const mark = active ? theme.accent('› ') : '  '
    const name = active ? theme.accent(item.name) : theme.text(item.name)
    return `${mark}${name}  ${theme.dim(item.hint)}`
  })
}

/**
 * Fixed-grid frame: always `rows` lines, each `cols` visible cells.
 * Colors are 24-bit SGR; measure width with stripAnsi / visibleWidth.
 */
export function renderPager(
  state: PagerState,
  cols: number,
  rows: number,
  themeName: ThemeName = 'dark',
  view: { phase?: number } = {},
): string {
  const theme = getTheme(themeName)
  const height = Math.max(0, rows)
  const width = Math.max(0, cols)
  if (height === 0) return ''

  const promptRows = Math.min(PROMPT_BOX_ROWS, height)
  const statusRows = height > promptRows ? Math.min(STATUS_ROWS, height - promptRows) : 0
  const chrome = promptRows + statusRows
  const bodyBudget = Math.max(0, height - chrome)

  const slash = slashMenuLines(state, theme)
  const slashTake = Math.min(slash.length, bodyBudget)
  const guest = !(state.statusLine || '').trim() || (state.statusLine || '').includes('not signed in')
  const welcome = isIdleWelcome(state)
    ? welcomeLines(guest, width, bodyBudget, view.phase ?? SISU_STILL_PHASE)
    : []
  const welcomeTake = Math.min(welcome.length, Math.max(0, bodyBudget - slashTake))
  const scrollBudget = bodyBudget - slashTake - welcomeTake

  const laid = layoutScrollback(state, width, theme)
  const lastEntry = Math.max(0, state.entries.length - 1)
  const visibleScroll = windowAroundSelected(
    laid.lines,
    laid.entryOf,
    state.selected,
    scrollBudget,
    lastEntry,
  )

  const shownWelcome = welcome.slice(0, welcomeTake)
  const extra = Math.max(0, welcomeTake + scrollBudget - shownWelcome.length - visibleScroll.length)
  const padTop = isIdleWelcome(state) && visibleScroll.length === 0 ? Math.floor(extra / 2) : 0
  const padBot = extra - padTop
  const body: string[] = [
    ...Array.from({ length: padTop }, () => ''),
    ...shownWelcome,
    ...Array.from({ length: padBot }, () => ''),
    ...visibleScroll,
    ...slash.slice(0, slashTake),
  ]

  const lines: string[] = body.map((line) => padVisible(line, width))

  if (statusRows > 0) {
    lines.push(padVisible(theme.dim(state.statusLine ?? ''), width))
  }

  if (promptRows >= 2) {
    lines.push(padVisible(theme.border('─'.repeat(width)), width))
    lines.push(padVisible(`${theme.accent(PROMPT_PREFIX)}${theme.text(state.draft)}`, width))
  } else if (promptRows === 1) {
    lines.push(padVisible(`${theme.accent(PROMPT_PREFIX)}${theme.text(state.draft)}`, width))
  }

  while (lines.length < height) lines.push(padVisible('', width))
  if (lines.length > height) lines.length = height

  return lines.map((line) => padVisible(line, width)).join('\n')
}

export { stripAnsi }
