import fs from 'fs'
import os from 'os'
import path from 'path'

export const DEFAULT_API_BASE = 'https://www.sisu.chat'

export interface AuthRecord {
  token: string
  email: string
  user_id: string
  api_base: string
  plan_code?: string
  name?: string
}

export interface SessionRecord {
  last_conversation_id?: string
  last_project_id?: string
  last_model?: string
}

export function getSisuHome(): string {
  const override = (process.env.SISU_HOME || '').trim()
  return override || path.join(os.homedir(), '.sisu')
}

export function sisuEngineHome(): string {
  return path.join(getSisuHome(), 'engine')
}

export function sisuAuthPath(): string {
  return path.join(getSisuHome(), 'auth.json')
}

function authPath(): string {
  return sisuAuthPath()
}

function workspacePath(): string {
  return path.join(getSisuHome(), 'workspace-paths.json')
}

function sessionPath(): string {
  return path.join(getSisuHome(), 'session.json')
}

const HOME_MODE = 0o700
const FILE_MODE = 0o600

function ensureSisuHome(): string {
  const home = getSisuHome()
  fs.mkdirSync(home, { recursive: true, mode: HOME_MODE })
  try {
    fs.chmodSync(home, HOME_MODE)
  } catch {
    // POSIX modes are ignored on some filesystems (e.g. Windows).
  }
  return home
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  ensureSisuHome()
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    mode: FILE_MODE,
  })
  try {
    fs.chmodSync(file, FILE_MODE)
  } catch {
    // POSIX modes are ignored on some filesystems (e.g. Windows).
  }
}

export function readAuth(): AuthRecord | null {
  const raw = readJson<Partial<AuthRecord> | null>(authPath(), null)
  if (!raw || typeof raw.token !== 'string' || !raw.token.trim()) return null
  return {
    token: raw.token,
    email: String(raw.email || ''),
    user_id: String(raw.user_id || ''),
    api_base: String(raw.api_base || DEFAULT_API_BASE).replace(/\/+$/, ''),
    plan_code: String(raw.plan_code || ''),
    name: String(raw.name || ''),
  }
}

export function writeAuth(record: AuthRecord): void {
  writeJson(authPath(), {
    token: record.token,
    email: record.email,
    user_id: record.user_id,
    api_base: record.api_base.replace(/\/+$/, '') || DEFAULT_API_BASE,
    plan_code: record.plan_code || '',
    name: record.name || '',
  })
}

export function readSession(): SessionRecord {
  return readJson<SessionRecord>(sessionPath(), {})
}

export function writeSession(record: SessionRecord): void {
  writeJson(sessionPath(), record)
}

export function clearAuth(): void {
  try {
    fs.unlinkSync(authPath())
  } catch {
    // already logged out
  }
}

export function readWorkspaces(): Record<string, string> {
  const raw = readJson<Record<string, string>>(workspacePath(), {})
  return raw && typeof raw === 'object' ? raw : {}
}

export function bindWorkspace(projectId: string, requestedPath: string): { projectId: string; path: string } {
  if (!projectId.trim()) throw new Error('missing project id')
  const trimmed = (requestedPath || '').trim()
  if (!trimmed) throw new Error('missing path')
  if (!fs.existsSync(trimmed)) throw new Error('directory does not exist')
  const stat = fs.statSync(trimmed)
  if (!stat.isDirectory()) throw new Error('path is not a directory')
  fs.accessSync(trimmed, fs.constants.R_OK)
  const resolved = fs.realpathSync.native(trimmed)
  const map = readWorkspaces()
  map[projectId] = resolved
  writeJson(workspacePath(), map)
  return { projectId, path: resolved }
}

export function requireAuth(): AuthRecord {
  const auth = readAuth()
  if (!auth) throw new Error('not logged in — run sisu login')
  return auth
}

export function describeStatus(): {
  home: string
  logged_in: boolean
  email: string
  name: string
  plan_code: string
  api_base: string
  workspaces: Record<string, string>
  model: string
} {
  const auth = readAuth()
  return {
    home: getSisuHome(),
    logged_in: Boolean(auth),
    email: auth?.email || '',
    name: auth?.name || '',
    plan_code: auth?.plan_code || '',
    api_base: auth?.api_base || process.env.SISU_API_BASE || DEFAULT_API_BASE,
    workspaces: readWorkspaces(),
    model: readSession().last_model || '',
  }
}
