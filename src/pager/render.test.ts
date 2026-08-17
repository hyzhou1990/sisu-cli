import { createPagerState, startAssistant, appendText, applyKey } from './model'
import { renderPager, stripAnsi } from './render'
import { visibleWidth } from './theme'

function visLines(frame: string): string[] {
  return frame.split('\n').map((line) => stripAnsi(line))
}

it('shows a signed-out welcome instead of an empty room', () => {
  const state = createPagerState()
  state.statusLine = 'sisu · not signed in'
  const frame = renderPager(state, 40, 12)
  const lines = visLines(frame)
  expect(lines).toHaveLength(12)
  expect(lines.every((line) => visibleWidth(line) === 40)).toBe(true)
  expect(frame).toMatch(/[@%#*+=.•-]|思溯/)
  expect(frame).toContain('Sign in to start')
  expect(frame).toContain('/login')
  expect((frame.match(/思有所溯/g) || []).length).toBe(1)
  expect((frame.match(/\/login  browser/g) || []).length).toBe(1)
  expect(frame).toMatch(/›/)
  expect(frame).toContain('\x1b[38;2;')
})

it('vertically centers the welcome so the ring is not glued to the top', () => {
  const state = createPagerState()
  state.statusLine = 'sisu · not signed in'
  const frame = renderPager(state, 80, 36)
  const lines = visLines(frame)
  expect(lines).toHaveLength(36)
  expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true)
  const firstInk = lines.findIndex((line) => /[@%#*+=-]/.test(line))
  expect(firstInk).toBeGreaterThan(2)
  expect((frame.match(/思有所溯/g) || []).length).toBe(1)
  expect((frame.match(/\/login  browser/g) || []).length).toBe(1)
})

it('paints user and assistant roles differently', () => {
  let state = createPagerState()
  state = {
    ...state,
    entries: [
      { id: 'u', kind: 'user', text: 'hello from you', folded: false },
      { id: 'a', kind: 'assistant', text: 'hello from sisu', folded: false },
    ],
    selected: 1,
  }
  const frame = renderPager(state, 40, 10)
  expect(stripAnsi(frame)).toContain('you  hello from you')
  expect(stripAnsi(frame)).toContain('hello from sisu')
})

it('dark and light themes emit different colors', () => {
  const state = createPagerState()
  state.statusLine = 'sisu · not signed in'
  const dark = renderPager(state, 40, 10, 'dark')
  const light = renderPager(state, 40, 10, 'light')
  expect(dark).not.toBe(light)
  expect(dark).toContain('\x1b[38;2;')
  expect(light).toContain('\x1b[38;2;')
})

it('fills a fixed grid with scrollback above and prompt below', () => {
  let state = startAssistant(createPagerState())
  state = appendText(state, 'hello from sisu')
  state.statusLine = 'ada@b.c · quota 12'
  const frame = renderPager(state, 40, 8)
  const lines = visLines(frame)
  expect(lines).toHaveLength(8)
  expect(lines.every((line) => visibleWidth(line) === 40)).toBe(true)
  expect(lines[6] + lines[7]).toMatch(/›/)
  expect(stripAnsi(frame)).toContain('hello from sisu')
  expect(stripAnsi(frame)).toContain('quota 12')
})

it('folded entries collapse to one row', () => {
  let state = startAssistant(createPagerState())
  state = appendText(state, 'line1\nline2\nline3')
  state = applyKey(state, { type: 'left' })
  const frame = stripAnsi(renderPager(state, 32, 6))
  expect(frame).toMatch(/assistant/)
  expect(frame).not.toContain('line2')
})

it('wraps long scrollback lines instead of dropping the tail', () => {
  let state = startAssistant(createPagerState())
  const body = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  state = appendText(state, body)
  const frame = renderPager(state, 16, 10)
  const lines = visLines(frame)
  expect(lines).toHaveLength(10)
  expect(lines.every((line) => visibleWidth(line) === 16)).toBe(true)
  const painted = lines.map((line) => line.trimEnd()).join('')
  for (const ch of body) {
    expect(painted).toContain(ch)
  }
})

it('keeps the selected entry in the visible window', () => {
  let state = createPagerState()
  for (let i = 0; i < 12; i += 1) {
    state = {
      ...state,
      entries: [
        ...state.entries,
        { id: `e${i}`, kind: 'status', text: `row-${i}`, folded: false },
      ],
      selected: i,
    }
  }
  state = { ...state, selected: 0 }
  const frame = stripAnsi(renderPager(state, 24, 8))
  expect(frame).toContain('row-0')
  expect(frame).toMatch(/▸/)
  expect(frame).not.toContain('row-11')
})

it('follows the tail when the last entry is selected', () => {
  let state = createPagerState()
  for (let i = 0; i < 12; i += 1) {
    state = {
      ...state,
      entries: [
        ...state.entries,
        { id: `e${i}`, kind: 'status', text: `row-${i}`, folded: false },
      ],
      selected: i,
    }
  }
  const frame = stripAnsi(renderPager(state, 24, 8))
  expect(frame).toContain('row-11')
  expect(frame).not.toContain('row-0')
})
