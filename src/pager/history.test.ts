import { entriesFromMessages } from './history'

it('maps user, assistant, and a tool_use block in order', () => {
  const { entries, truncated } = entriesFromMessages([
    { id: '1', role: 'user', content: 'hello' },
    {
      id: '2',
      role: 'assistant',
      content: 'done',
      content_blocks: [{ type: 'tool_use', name: 'read_file', content: { path: 'a.ts' } }],
    },
  ])
  expect(truncated).toBe(false)
  expect(entries.map((entry) => [entry.kind, entry.text.startsWith('read_file') ? 'read_file' : entry.text])).toEqual([
    ['user', 'hello'],
    ['tool', 'read_file'],
    ['assistant', 'done'],
  ])
})

it('emits a tool entry from message_type when there are no blocks', () => {
  const { entries } = entriesFromMessages([
    { id: '1', role: 'assistant', content: 'ran grep', message_type: 'tool_result' },
  ])
  expect(entries).toEqual([{ kind: 'tool', text: 'ran grep', folded: false }])
})

it('drops empty messages and folds tool text longer than 8 lines', () => {
  const long = Array.from({ length: 9 }, (_, i) => `L${i}`).join('\n')
  const { entries } = entriesFromMessages([
    { id: '0', role: 'user', content: '' },
    { id: '1', role: 'assistant', content: long, message_type: 'tool_use' },
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0].kind).toBe('tool')
  expect(entries[0].folded).toBe(true)
})

it('reads persisted description, result_summary, and input on tool snapshots', () => {
  const { entries } = entriesFromMessages([
    {
      id: '1',
      role: 'assistant',
      content: 'done',
      content_blocks: [
        { type: 'tool_start', tool: 'web_search', description: 'query=sisu tui' },
        { type: 'tool_end', tool: 'web_search', success: true, result_summary: '3 hits' },
        { tool: 'read_file', input: { path: 'a.ts' } },
      ],
    },
  ])
  expect(entries.filter((entry) => entry.kind === 'tool').map((entry) => entry.text)).toEqual([
    'web_search · query=sisu tui',
    'web_search · ok · 3 hits',
    'read_file · path=a.ts',
  ])
})

it('maps tool_start, tool_end, and a nameless { tool } block as tool entries', () => {
  const { entries } = entriesFromMessages([
    {
      id: '1',
      role: 'assistant',
      content: 'done',
      content_blocks: [
        { type: 'tool_start', name: 'web_search', text: 'start' },
        { type: 'tool_end', name: 'web_search', text: 'end' },
        { tool: 'read_file', content: { path: 'a.ts' } },
      ],
    },
  ])
  expect(entries.map((entry) => [entry.kind, entry.text.split(' · ')[0]])).toEqual([
    ['tool', 'web_search'],
    ['tool', 'web_search'],
    ['tool', 'read_file'],
    ['assistant', 'done'],
  ])
})

it('keeps the last 200 mapped items and flags truncation', () => {
  const messages = Array.from({ length: 210 }, (_, i) => ({
    id: String(i),
    role: 'user' as const,
    content: `m${i}`,
  }))
  const { entries, truncated } = entriesFromMessages(messages)
  expect(truncated).toBe(true)
  expect(entries).toHaveLength(200)
  expect(entries[0].text).toBe('m10')
  expect(entries[199].text).toBe('m209')
})
