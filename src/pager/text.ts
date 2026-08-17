/** Display-side text: hide model scratch and wrap by terminal cells. */

import { visibleWidth } from './theme'

const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think>/gi
const THINK_OPEN = /<think\b[^>]*>[\s\S]*$/i

export function visibleAssistantText(raw: string): string {
  let text = String(raw || '')
  text = text.replace(THINK_BLOCK, '')
  text = text.replace(THINK_OPEN, '')
  return text.replace(/^\n+/, '').replace(/\n+$/, '')
}

export function wrapCells(text: string, width: number): string[] {
  const max = Math.max(1, width)
  if (!text) return ['']
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      out.push('')
      continue
    }
    let line = ''
    for (const ch of paragraph) {
      if (visibleWidth(line + ch) > max) {
        if (line) out.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}
