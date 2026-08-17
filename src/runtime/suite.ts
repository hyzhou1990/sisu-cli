import fs from 'fs'
import path from 'path'

/** Absolute path to the vendored grok-build first-party tree. */
export function grokBuildRoot(): string {
  return path.resolve(__dirname, '..', '..', 'vendor', 'grok-build')
}

export const GROK_BUILD_SURFACE = {
  agent: 'crates/codegen/xai-grok-agent',
  tools: 'crates/codegen/xai-grok-tools',
  pager: 'crates/codegen/xai-grok-pager',
  hooks: 'crates/codegen/xai-grok-hooks',
  mcp: 'crates/codegen/xai-grok-mcp',
  plugins: 'crates/codegen/xai-grok-plugin-marketplace',
  subagents: 'crates/codegen/xai-grok-subagent-resolution',
  skills: 'crates/codegen/xai-grok-tools/src/implementations/skills',
} as const

export type GrokBuildSurface = keyof typeof GROK_BUILD_SURFACE

export function grokBuildPath(surface: GrokBuildSurface | 'license' | 'notice' | 'thirdParty'): string {
  const root = grokBuildRoot()
  if (surface === 'license') return path.join(root, 'LICENSE')
  if (surface === 'notice') return path.join(root, 'NOTICE')
  if (surface === 'thirdParty') return path.join(root, 'THIRD-PARTY-NOTICES')
  return path.join(root, GROK_BUILD_SURFACE[surface])
}

export function grokBuildSuitePresent(): { surface: string; path: string; ok: boolean }[] {
  const keys: Array<GrokBuildSurface | 'license' | 'notice'> = [
    'agent',
    'tools',
    'pager',
    'hooks',
    'mcp',
    'plugins',
    'subagents',
    'skills',
    'license',
    'notice',
  ]
  return keys.map((surface) => {
    const file = grokBuildPath(surface)
    return { surface, path: file, ok: fs.existsSync(file) }
  })
}

export function assertGrokBuildSuite(): void {
  const missing = grokBuildSuitePresent().filter((row) => !row.ok)
  if (missing.length) {
    throw new Error(`grok-build suite missing: ${missing.map((row) => row.surface).join(', ')}`)
  }
}

export const PRODUCT_NAME = 'SiSu'
export const PRODUCT_BIN = 'sisu'
export const COMPLETE_PATH = '/api/runtime/complete'
export const OPENAI_COMPAT_PATH = '/api/runtime/v1/chat/completions'
