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

it('fetchModelCatalog falls back to /api/chat/models when runtime is 404', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = jest.fn(async (url: string) => {
    if (String(url).includes('/api/runtime/v1/models')) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ detail: 'not found' }),
        text: async (): Promise<string> => '',
      }
    }
    expect(url).toBe('https://www.sisu.chat/api/chat/models')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        default_model: 'kimi-k2.5',
        models: [{ name: 'kimi-k2.5', display_name: 'Kimi K2.5' }],
      }),
      text: async (): Promise<string> => '',
    }
  })
  try {
    const { models, defaultModel } = await fetchModelCatalog(http)
    expect(http.mock.calls.map((row) => row[0])).toEqual([
      'https://www.sisu.chat/api/runtime/v1/models',
      'https://www.sisu.chat/api/chat/models',
    ])
    expect(models[0]).toEqual({ name: 'kimi-k2.5', label: 'Kimi K2.5' })
    expect(defaultModel).toBe('kimi-k2.5')
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('fetchModelCatalog does not fall back when runtime returns FastAPI 401 detail', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = jest.fn(async (url: string) => {
    if (String(url).includes('/api/runtime/v1/models')) {
      return {
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Not authenticated' }),
        text: async (): Promise<string> => '',
      }
    }
    throw new Error(`unexpected fallback request ${url}`)
  })
  try {
    await expect(fetchModelCatalog(http)).rejects.toThrow(/Not authenticated|models failed \(401\)/)
    expect(http.mock.calls.map((row) => row[0])).toEqual(['https://www.sisu.chat/api/runtime/v1/models'])
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
