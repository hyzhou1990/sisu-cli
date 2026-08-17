import { summarizePersistedTool } from '../toolSummary'
import type { EntryKind, PagerEntry } from './model'

export interface CloudMessage {
  id: string
  role: string
  content: string
  message_type?: string | null
  content_blocks?: Array<{
    type?: string
    name?: string
    tool?: string
    content?: unknown
    text?: string
    description?: string
    result_summary?: string
    result_preview?: string
    success?: boolean
    input?: unknown
  }> | null
}

const TOOL_BLOCKS = new Set(['tool_use', 'tool_status', 'tool_result', 'tool_start', 'tool_end'])
const TOOL_TYPES = new Set(['tool_use', 'tool_result'])

function lineCount(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

function isToolBlock(block: NonNullable<CloudMessage['content_blocks']>[number]): boolean {
  const type = String(block.type || '')
  if (TOOL_BLOCKS.has(type)) return true
  return !type && Boolean(block.tool || block.name)
}

function toolBlockText(block: NonNullable<CloudMessage['content_blocks']>[number]): string {
  return summarizePersistedTool(block as Record<string, unknown>)
}

function asEntry(kind: EntryKind, text: string): Omit<PagerEntry, 'id'> {
  return { kind, text, folded: kind === 'tool' && lineCount(text) > 8 }
}

export function entriesFromMessages(
  messages: CloudMessage[],
  limit = 200,
): { entries: Array<Omit<PagerEntry, 'id'>>; truncated: boolean } {
  const raw: Array<Omit<PagerEntry, 'id'>> = []
  for (const msg of messages) {
    const blocks = (msg.content_blocks || []).filter(isToolBlock)
    for (const block of blocks) raw.push(asEntry('tool', toolBlockText(block)))

    const content = (msg.content || '').trim()
    const isToolMsg = TOOL_TYPES.has(String(msg.message_type || ''))
    if (isToolMsg && blocks.length === 0 && content) {
      raw.push(asEntry('tool', content))
      continue
    }
    if (isToolMsg) continue
    if (!content) continue
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    if (blocks.length > 0 && content === toolBlockText(blocks[0])) continue
    raw.push(asEntry(msg.role, content))
  }
  const truncated = raw.length > limit
  return { entries: truncated ? raw.slice(-limit) : raw, truncated }
}
