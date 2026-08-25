import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCli } from '../main'
import { readSession, writeAuth, writeSession } from '../store'
import { execCommand } from '../commands'
import { grokBuildPath } from './suite'
import { sisuGrokBuildEnv, writeSisuGrokConfig } from './launch'

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-launch-'))
  process.env.SISU_HOME = home
  writeAuth({
    token: 'jwt',
    email: 'ada@sisu.chat',
    user_id: 'u1',
    api_base: 'https://www.sisu.chat',
  })
  return home
}

it('sisuGrokBuildEnv stamps a stable SISU_CONVERSATION_ID', () => {
  const previousHome = process.env.SISU_HOME
  const previousConv = process.env.SISU_CONVERSATION_ID
  const home = makeHome()
  try {
    delete process.env.SISU_CONVERSATION_ID
    const a = sisuGrokBuildEnv()
    const b = sisuGrokBuildEnv()
    expect(a.SISU_CONVERSATION_ID).toMatch(/^[0-9a-f-]{36}$/i)
    expect(a.SISU_CONVERSATION_ID).toBe(b.SISU_CONVERSATION_ID)
    expect(readSession().last_conversation_id).toBe(a.SISU_CONVERSATION_ID)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousConv === undefined) delete process.env.SISU_CONVERSATION_ID
    else process.env.SISU_CONVERSATION_ID = previousConv
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv keeps a valid UUID last_conversation_id', () => {
  const previousHome = process.env.SISU_HOME
  const previousConv = process.env.SISU_CONVERSATION_ID
  const home = makeHome()
  const kept = '11111111-1111-1111-1111-111111111111'
  try {
    delete process.env.SISU_CONVERSATION_ID
    writeSession({ last_conversation_id: kept, last_model: 'sisu-lite' })
    const env = sisuGrokBuildEnv()
    expect(env.SISU_CONVERSATION_ID).toBe(kept)
    expect(readSession().last_conversation_id).toBe(kept)
    expect(readSession().last_model).toBe('sisu-lite')
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousConv === undefined) delete process.env.SISU_CONVERSATION_ID
    else process.env.SISU_CONVERSATION_ID = previousConv
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv replaces a non-UUID last_conversation_id', () => {
  const previousHome = process.env.SISU_HOME
  const previousConv = process.env.SISU_CONVERSATION_ID
  const home = makeHome()
  try {
    delete process.env.SISU_CONVERSATION_ID
    writeSession({ last_conversation_id: 'conv-99' })
    const env = sisuGrokBuildEnv()
    expect(env.SISU_CONVERSATION_ID).toMatch(/^[0-9a-f-]{36}$/i)
    expect(env.SISU_CONVERSATION_ID).not.toBe('conv-99')
    expect(readSession().last_conversation_id).toBe(env.SISU_CONVERSATION_ID)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    if (previousConv === undefined) delete process.env.SISU_CONVERSATION_ID
    else process.env.SISU_CONVERSATION_ID = previousConv
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisuGrokBuildEnv points grok-build at SiSu via GROK_XAI_API_BASE_URL', () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  try {
    const env = sisuGrokBuildEnv()
    expect(env.GROK_XAI_API_BASE_URL).toBe('https://www.sisu.chat/api/runtime/v1')
    expect(env.GROK_XAI_API_BASE_URL).toContain('/api/runtime/v1')
    expect(env.GROK_TELEMETRY_ENABLED).toBe('0')
    const configPath = writeSisuGrokConfig()
    expect(fs.readFileSync(configPath, 'utf8')).toContain('xai_api_base_url = "https://www.sisu.chat/api/runtime/v1"')
    const bootPath = path.join(path.dirname(grokBuildPath('pager')), 'xai-grok-pager-bin', 'src', 'sisu_boot.rs')
    if (fs.existsSync(bootPath)) {
      const boot = fs.readFileSync(bootPath, 'utf8')
      expect(boot).toMatch(/GROK_XAI_API_BASE_URL/)
      expect(boot).toMatch(/api\/runtime\/v1/)
    }
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('sisu exec --stub completes a local-agent turn with a tool result twice', async () => {
  const previousHome = process.env.SISU_HOME
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-ws-'))
  fs.writeFileSync(path.join(cwd, 'hello.txt'), 'hello from workspace\n')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-home-'))
  process.env.SISU_HOME = home
  const previousCwd = process.cwd()
  process.chdir(cwd)
  const runs: string[] = []
  try {
    for (let i = 0; i < 2; i += 1) {
      const writes: string[] = []
      const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        writes.push(String(chunk))
        return true
      })
      try {
        const code = await runCli(['exec', '--stub', '--new', 'read hello.txt'])
        expect(code).toBe(0)
        const out = writes.join('')
        expect(out).toMatch(/local tool result/)
        expect(out).toMatch(/hello from workspace/)
        runs.push(out)
      } finally {
        stdout.mockRestore()
      }
    }
    expect(runs).toHaveLength(2)
    expect(runs[0]).toBe(runs[1])
  } finally {
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('execCommand stub path changes a workspace file through the shipped loop', async () => {
  const previousHome = process.env.SISU_HOME
  const home = makeHome()
  process.env.SISU_HOME = home
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-exec-'))
  fs.writeFileSync(path.join(cwd, 'hello.txt'), 'before\n')
  try {
    const result = await execCommand('edit', {
      stub: true,
      cwd,
      newConversation: true,
      modelClient: {
        async complete(request) {
          const hasTool = request.messages.some((row) => row.role === 'tool')
          if (!hasTool) {
            return {
              text: '',
              tool_calls: [
                {
                  id: 'e1',
                  name: 'search_replace',
                  arguments: { file_path: 'hello.txt', old_string: 'before', new_string: 'after' },
                },
              ],
            }
          }
          return { text: `edited:${request.messages.at(-1)?.content}`, tool_calls: [] }
        },
      },
    })
    expect(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8')).toBe('after\n')
    expect(result.text).toMatch(/edited:The file hello.txt has been updated/)
  } finally {
    if (previousHome === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
