import { createPagerState, startAssistant, appendText, applyKey } from './model'
import { renderPager } from './render'

it('shows a signed-out welcome instead of an empty room', () => {
  const state = createPagerState()
  state.statusLine = 'sisu · not signed in'
  const frame = renderPager(state, 40, 12)
  const lines = frame.split('\n')
  expect(lines).toHaveLength(12)
  expect(lines.every((line) => line.length === 40)).toBe(true)
  expect(frame).toContain('SISU')
  expect(frame).toContain('Sign in to start')
  expect(frame).toContain('/login')
  expect(frame).toMatch(/›/)
})

it('fills a fixed grid with scrollback above and prompt below', () => {
  let state = startAssistant(createPagerState())
  state = appendText(state, 'hello from sisu')
  state.statusLine = 'ada@b.c · quota 12'
  const frame = renderPager(state, 40, 8)
  const lines = frame.split('\n')
  expect(lines).toHaveLength(8)
  expect(lines.every((line) => line.length === 40)).toBe(true)
  expect(lines[6] + lines[7]).toMatch(/›/)
  expect(frame).toContain('hello from sisu')
  expect(frame).toContain('quota 12')
})

it('folded entries collapse to one row', () => {
  let state = startAssistant(createPagerState())
  state = appendText(state, 'line1\nline2\nline3')
  state = applyKey(state, { type: 'left' })
  const frame = renderPager(state, 32, 6)
  expect(frame).toMatch(/assistant/)
  expect(frame).not.toContain('line2')
})

it('wraps long scrollback lines instead of dropping the tail', () => {
  let state = startAssistant(createPagerState())
  const body = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  state = appendText(state, body)
  const frame = renderPager(state, 16, 10)
  const lines = frame.split('\n')
  expect(lines).toHaveLength(10)
  expect(lines.every((line) => line.length === 16)).toBe(true)
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
  const frame = renderPager(state, 24, 8)
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
  const frame = renderPager(state, 24, 8)
  expect(frame).toContain('row-11')
  expect(frame).not.toContain('row-0')
})
