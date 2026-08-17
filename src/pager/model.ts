export type EntryKind = 'user' | 'assistant' | 'status' | 'tool'

export interface PagerEntry {
  id: string
  kind: EntryKind
  text: string
  folded: boolean
}

export interface PagerState {
  entries: PagerEntry[]
  selected: number
  draft: string
  slashOpen: boolean
  conversationId: string
  /** Highlight index into filterSlash(draft) while slash menu is open. */
  slashIndex: number
  /** Optional status chrome above the prompt (e.g. user@host · quota). */
  statusLine?: string
}

export type PagerKey =
  | { type: 'char'; value: string }
  | { type: 'enter' | 'backspace' | 'up' | 'down' | 'left' | 'right' | 'escape' }

export const SLASH_COMMANDS: Array<{ name: string; hint: string }> = [
  { name: '/login', hint: 'Sign in with the browser' },
  { name: '/logout', hint: 'Sign out of this terminal' },
  { name: '/new', hint: 'Start a new conversation (alias: /clear)' },
  { name: '/resume', hint: 'Resume a conversation (alias: /history)' },
  { name: '/model', hint: 'Switch model (alias: /m)' },
  { name: '/models', hint: 'List models available to your account' },
  { name: '/copy', hint: 'Copy the last assistant reply' },
  { name: '/export', hint: 'Write this conversation to a markdown file' },
  { name: '/status', hint: 'Show session status' },
  { name: '/ls', hint: 'List local workspace files' },
  { name: '/training', hint: 'Training mode' },
  { name: '/theme', hint: 'Toggle theme' },
  { name: '/help', hint: 'Show help' },
  { name: '/quit', hint: 'Quit the pager (alias: /exit)' },
]

/** Alias token → primary slash command name. */
const SLASH_ALIASES: Record<string, string> = {
  '/clear': '/new',
  '/history': '/resume',
  '/exit': '/quit',
  '/m': '/model',
}

let nextEntryId = 1

function entryId(): string {
  const id = `e${nextEntryId}`
  nextEntryId += 1
  return id
}

export function createPagerState(): PagerState {
  return {
    entries: [],
    selected: 0,
    draft: '',
    slashOpen: false,
    conversationId: '',
    slashIndex: 0,
  }
}

function clampSelected(entries: PagerEntry[], selected: number): number {
  if (entries.length === 0) return 0
  if (selected < 0) return 0
  if (selected >= entries.length) return entries.length - 1
  return selected
}

function clampSlashIndex(draft: string, slashIndex: number): number {
  const items = filterSlash(draft)
  if (items.length === 0) return 0
  if (slashIndex < 0) return items.length - 1
  if (slashIndex >= items.length) return 0
  return slashIndex
}

function withDraft(state: PagerState, draft: string, slashOpen?: boolean): PagerState {
  const open = slashOpen ?? (draft.startsWith('/') ? state.slashOpen || draft === '/' : false)
  return {
    ...state,
    draft,
    slashOpen: open && draft.startsWith('/'),
    slashIndex: open && draft.startsWith('/') ? clampSlashIndex(draft, state.slashIndex) : 0,
  }
}

function setEntryFold(state: PagerState, folded: boolean): PagerState {
  if (state.entries.length === 0) return state
  const selected = clampSelected(state.entries, state.selected)
  const entries = state.entries.map((entry, index) =>
    index === selected ? { ...entry, folded } : entry,
  )
  return { ...state, entries, selected }
}

export function filterSlash(draft: string): Array<{ name: string; hint: string }> {
  const query = draft.trim().toLowerCase()
  if (!query.startsWith('/')) return []

  const matched = new Map<string, { name: string; hint: string }>()

  for (const cmd of SLASH_COMMANDS) {
    if (cmd.name.startsWith(query) || query.startsWith(cmd.name)) {
      matched.set(cmd.name, cmd)
    }
  }

  for (const [alias, primary] of Object.entries(SLASH_ALIASES)) {
    if (alias.startsWith(query) || query.startsWith(alias)) {
      const cmd = SLASH_COMMANDS.find((item) => item.name === primary)
      if (cmd) matched.set(cmd.name, cmd)
    }
  }

  // Preserve canonical order
  return SLASH_COMMANDS.filter((cmd) => matched.has(cmd.name))
}

export function startAssistant(state: PagerState): PagerState {
  const entry: PagerEntry = {
    id: entryId(),
    kind: 'assistant',
    text: '',
    folded: false,
  }
  const entries = [...state.entries, entry]
  return {
    ...state,
    entries,
    selected: entries.length - 1,
  }
}

/** Insert a tool card before the live (last) assistant so the answer stays the turn tail. */
export function insertToolBeforeLiveAssistant(state: PagerState, entry: PagerEntry): PagerState {
  let live = -1
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    if (state.entries[i].kind === 'assistant') {
      live = i
      break
    }
  }
  if (live < 0) {
    const entries = [...state.entries, entry]
    return { ...state, entries, selected: entries.length - 1 }
  }
  const entries = [...state.entries.slice(0, live), entry, ...state.entries.slice(live)]
  return { ...state, entries, selected: live + 1 }
}

export function appendText(state: PagerState, text: string): PagerState {
  if (!text) return state
  // Append onto the last assistant entry (the live stream target).
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    if (state.entries[i].kind === 'assistant') {
      const entries = state.entries.slice()
      entries[i] = { ...entries[i], text: entries[i].text + text }
      return { ...state, entries }
    }
  }
  // No assistant yet — create one and seed it.
  const seeded = startAssistant(state)
  return appendText(seeded, text)
}

export function applyKey(state: PagerState, key: PagerKey): PagerState {
  switch (key.type) {
    case 'char': {
      const draft = state.draft + key.value
      if (key.value === '/' && state.draft === '') {
        return { ...state, draft: '/', slashOpen: true, slashIndex: 0 }
      }
      if (state.slashOpen || draft.startsWith('/')) {
        return withDraft(state, draft, draft.startsWith('/'))
      }
      return { ...state, draft }
    }
    case 'backspace': {
      if (!state.draft) return state
      const draft = state.draft.slice(0, -1)
      if (state.slashOpen) {
        if (!draft.startsWith('/')) {
          return { ...state, draft, slashOpen: false, slashIndex: 0 }
        }
        return withDraft(state, draft, true)
      }
      return { ...state, draft }
    }
    case 'escape': {
      if (state.slashOpen) {
        return { ...state, slashOpen: false, slashIndex: 0 }
      }
      return state
    }
    case 'enter': {
      // Command execution is owned by the app layer; model only retains draft.
      return state
    }
    case 'left':
      return setEntryFold(state, true)
    case 'right':
      return setEntryFold(state, false)
    case 'up': {
      if (state.slashOpen) {
        const items = filterSlash(state.draft)
        if (items.length === 0) return state
        const slashIndex = (state.slashIndex - 1 + items.length) % items.length
        return { ...state, slashIndex }
      }
      if (state.draft === '' && state.entries.length > 0) {
        const selected = clampSelected(state.entries, state.selected - 1)
        return { ...state, selected }
      }
      return state
    }
    case 'down': {
      if (state.slashOpen) {
        const items = filterSlash(state.draft)
        if (items.length === 0) return state
        const slashIndex = (state.slashIndex + 1) % items.length
        return { ...state, slashIndex }
      }
      if (state.draft === '' && state.entries.length > 0) {
        const selected = clampSelected(state.entries, state.selected + 1)
        return { ...state, selected }
      }
      return state
    }
    default:
      return state
  }
}
