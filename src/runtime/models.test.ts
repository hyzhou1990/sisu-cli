import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeAuth, readSession } from '../store'
import { fetchModelCatalog, resolveRuntimeModel } from './models'

it('fetchModelCatalog uses /api/runtime/v1/models', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: 'kimi-k2.5', name: 'Kimi K2.5', owned_by: 'sisu' }],
      default_model: 'kimi-k2.5',
    }),
    text: async () => '',
  })
  try {
    const { models, defaultModel } = await fetchModelCatalog(http)
    expect(http.mock.calls[0][0]).toMatch(/\/api\/runtime\/v1\/models$/)
    expect(http.mock.calls[0][0]).not.toMatch(/\/api\/chat\/models/)
    expect(models[0].name).toBe('kimi-k2.5')
    expect(defaultModel).toBe('kimi-k2.5')
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('first-run exec without last_model uses GET /api/runtime/v1/models default', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = jest.fn(async (url: string) => {
    expect(url).toBe('https://www.sisu.chat/api/runtime/v1/models')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        default_model: 'kimi-k2.5',
        data: [
          { id: 'kimi-k2.5', name: 'Kimi', owned_by: 'sisu' },
          { id: 'grok-4.6', name: 'Grok', owned_by: 'sisu' },
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
