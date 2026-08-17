import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeAuth, readSession } from '../store'
import { resolveRuntimeModel } from './models'

it('first-run exec without last_model uses GET /api/chat/models default', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = jest.fn(async (url: string) => {
    expect(url).toBe('https://www.sisu.chat/api/chat/models')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        default_model: 'kimi-k2.5',
        models: [
          { name: 'kimi-k2.5', display_name: 'Kimi' },
          { name: 'grok-4.6', display_name: 'Grok' },
        ],
      }),
      text: async () => '',
    }
  })
  try {
    const name = await resolveRuntimeModel(http)
    expect(name).toBe('kimi-k2.5')
    expect(name).not.toBe('sisu-default')
    expect(readSession().last_model).toBe('kimi-k2.5')
    expect(http).toHaveBeenCalledTimes(1)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
