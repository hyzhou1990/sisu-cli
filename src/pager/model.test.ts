import { applyKey, appendText, createPagerState, filterSlash, insertToolBeforeLiveAssistant, SLASH_COMMANDS, startAssistant } from './model'

describe('pager model', () => {
  it('opens slash filter and keeps draft editing separate from selection', () => {
    let state = createPagerState()
    state = applyKey(state, { type: 'char', value: '/' })
    expect(state.slashOpen).toBe(true)
    expect(filterSlash('/re').some((item) => item.name === '/resume')).toBe(true)
    state = applyKey(state, { type: 'escape' })
    expect(state.slashOpen).toBe(false)
  })

  it('keeps the live assistant as the turn tail when a tool card arrives', () => {
    let state = startAssistant(createPagerState())
    state = insertToolBeforeLiveAssistant(state, {
      id: 't1',
      kind: 'tool',
      text: 'read_file · call · path=a.ts',
      folded: false,
    })
    state = appendText(state, 'final-answer')
    expect(state.entries.map((entry) => entry.kind)).toEqual(['tool', 'assistant'])
    expect(state.entries.at(-1)?.text).toBe('final-answer')
    expect(state.selected).toBe(state.entries.length - 1)
    expect(state.entries[state.selected].kind).toBe('assistant')
  })

  it('appends streamed text onto the live assistant entry', () => {
    let state = createPagerState()
    state = startAssistant(state)
    state = appendText(state, 'Hel')
    state = appendText(state, 'lo')
    expect(state.entries.filter((entry) => entry.kind === 'assistant')).toHaveLength(1)
    expect(state.entries.at(-1)?.text).toBe('Hello')
  })

  it('lists /login as the in-session sign-in command', () => {
    const login = SLASH_COMMANDS.find((item) => item.name === '/login')
    expect(login?.hint).toMatch(/browser/i)
    expect(SLASH_COMMANDS[0].name).toBe('/login')
  })

  it('describes /ls as local workspace files, not conversations', () => {
    const ls = SLASH_COMMANDS.find((item) => item.name === '/ls')
    expect(ls?.hint).toMatch(/workspace files/i)
    expect(ls?.hint).not.toMatch(/conversation/i)
  })

  it('left/right toggle fold on the selected entry', () => {
    let state = startAssistant(createPagerState())
    state = appendText(state, 'block')
    state = applyKey(state, { type: 'left' })
    expect(state.entries[state.selected].folded).toBe(true)
    state = applyKey(state, { type: 'right' })
    expect(state.entries[state.selected].folded).toBe(false)
  })
})
