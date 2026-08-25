import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { ensureConversationId, readAuth, getSisuHome } from '../store'
import { grokBuildRoot } from './suite'
import { openaiCompatUrl } from './adapter'

export function grokBuildBinaryCandidates(): string[] {
  const env = (process.env.SISU_GROK_BIN || '').trim()
  const root = grokBuildRoot()
  const packaged = path.resolve(__dirname, '..', 'bin', 'xai-grok-pager')
  const npmInstalled = path.join(getSisuHome(), 'bin', process.platform === 'win32' ? 'xai-grok-pager.exe' : 'xai-grok-pager')
  return [
    env,
    npmInstalled,
    packaged,
    path.join(root, 'target', 'release', 'xai-grok-pager'),
    path.join(root, 'target', 'debug', 'xai-grok-pager'),
    path.join(root, 'target', 'release', 'sisu-agent'),
  ].filter(Boolean)
}

export function findGrokBuildBinary(): string | null {
  for (const candidate of grokBuildBinaryCandidates()) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

export function sisuRuntimeApiBase(apiBase: string): string {
  return openaiCompatUrl(apiBase).replace(/\/chat\/completions$/, '')
}

export function writeSisuGrokConfig(): string {
  const auth = readAuth()
  const home = getSisuHome()
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const file = path.join(home, 'config.toml')
  const runtimeBase = sisuRuntimeApiBase(auth?.api_base || process.env.SISU_API_BASE || 'https://www.sisu.chat')
  const body = [
    '# sisu-managed grok-build config — SiSu auth + models + quota',
    '[endpoints]',
    `xai_api_base_url = "${runtimeBase}"`,
    '',
  ].join('\n')
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!existing || existing.includes('sisu-managed grok-build')) {
    fs.writeFileSync(file, `${body}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  return file
}

export function sisuGrokBuildEnv(): NodeJS.ProcessEnv {
  const auth = readAuth()
  const home = getSisuHome()
  const runtimeBase = auth ? sisuRuntimeApiBase(auth.api_base) : ''
  return {
    ...process.env,
    GROK_HOME: process.env.GROK_HOME || home,
    SISU_HOME: home,
    GROK_TELEMETRY_ENABLED: process.env.GROK_TELEMETRY_ENABLED || '0',
    XAI_API_KEY: process.env.XAI_API_KEY || auth?.token || '',
    SISU_API_BASE: auth?.api_base || process.env.SISU_API_BASE || 'https://www.sisu.chat',
    SISU_CONVERSATION_ID: ensureConversationId(),
    ...(runtimeBase
      ? {
          GROK_XAI_API_BASE_URL: runtimeBase,
          XAI_API_BASE_URL: runtimeBase,
        }
      : {}),
  }
}

export function launchGrokBuildHeadless(prompt: string, cwd: string): { status: number; stdout: string; stderr: string; binary: string | null } {
  const binary = findGrokBuildBinary()
  if (!binary) {
    return { status: 127, stdout: '', stderr: 'grok-build binary not built', binary: null }
  }
  const result = spawnSync(binary, ['-p', prompt], {
    cwd,
    encoding: 'utf8',
    env: sisuGrokBuildEnv(),
    timeout: 30_000,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
    binary,
  }
}
