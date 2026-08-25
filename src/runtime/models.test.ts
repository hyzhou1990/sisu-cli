import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeAuth, readSession, writeSession } from '../store'
import { fetchModelCatalog, resolveCatalogModel, resolveRuntimeModel } from './models'

it('fetchModelCatalog uses /api/runtime/v1/models', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: 'sisu-lite', name: 'SiSu-Lite', owned_by: 'sisu' }],
      default_model: 'sisu-lite',
    }),
    text: async () => '',
  })
  try {
    const { models, defaultModel } = await fetchModelCatalog(http)
    expect(http.mock.calls[0][0]).toMatch(/\/api\/runtime\/v1\/models$/)
    expect(http.mock.calls[0][0]).not.toMatch(/\/api\/chat\/models/)
    expect(models[0].name).toBe('sisu-lite')
    expect(defaultModel).toBe('sisu-lite')
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

it('does not fall back to /api/chat/models on runtime 404', async () => {
  const calls: string[] = []
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = async (url: string) => {
    calls.push(url)
    if (url.includes('/api/runtime/v1/models')) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    throw new Error(`unexpected ${url}`)
  }
  try {
    await expect(fetchModelCatalog(http as any)).rejects.toThrow(/models failed \(404\)/)
    expect(calls.some((u) => u.includes('/api/chat/models'))).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('does not fall back to /api/chat/models on runtime 502', async () => {
  const calls: string[] = []
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  const http = async (url: string) => {
    calls.push(url)
    if (url.includes('/api/runtime/v1/models')) {
      return { ok: false, status: 502, json: async () => ({ detail: 'bad gateway' }) }
    }
    throw new Error(`unexpected ${url}`)
  }
  try {
    await expect(fetchModelCatalog(http as any)).rejects.toThrow(/bad gateway|models failed \(502\)/)
    expect(calls.some((u) => u.includes('/api/chat/models'))).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('resolves sisu-pro aliases and rejects kimi', async () => {
  const models = [
    { name: 'sisu-lite', label: 'SiSu-Lite' },
    { name: 'sisu-pro', label: 'SiSu-Pro' },
    { name: 'sisu-ultra', label: 'SiSu-Ultra' },
  ]
  expect(resolveCatalogModel('pro', models)?.name).toBe('sisu-pro')
  expect(resolveCatalogModel('SiSu-Ultra', models)?.name).toBe('sisu-ultra')
  expect(resolveCatalogModel('kimi', models)).toBeUndefined()
  expect(resolveCatalogModel('kimi-k3', models)).toBeUndefined()
  expect(resolveCatalogModel('claude', models)).toBeUndefined()
  expect(resolveCatalogModel('grok-4.6', models)).toBeUndefined()
  expect(resolveCatalogModel('k3', models)).toBeUndefined()
})

it('drops stale last_model and uses default sisu-lite', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-model-'))
  const previous = process.env.SISU_HOME
  process.env.SISU_HOME = home
  writeAuth({ token: 'jwt', email: 'ada@sisu.chat', user_id: 'u1', api_base: 'https://www.sisu.chat' })
  writeSession({ last_model: 'claude-opus-4.8' })
  const http = jest.fn(async (url: string) => {
    expect(url).toBe('https://www.sisu.chat/api/runtime/v1/models')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        default_model: 'sisu-lite',
        data: [
          { id: 'sisu-lite', name: 'SiSu-Lite', owned_by: 'sisu' },
          { id: 'sisu-pro', name: 'SiSu-Pro', owned_by: 'sisu' },
          { id: 'sisu-ultra', name: 'SiSu-Ultra', owned_by: 'sisu' },
        ],
      }),
      text: async () => '',
    }
  })
  try {
    const name = await resolveRuntimeModel(http)
    expect(name).toBe('sisu-lite')
    expect(readSession().last_model).toBe('sisu-lite')
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
        default_model: 'sisu-lite',
        data: [
          { id: 'sisu-lite', name: 'SiSu-Lite', owned_by: 'sisu' },
          { id: 'sisu-pro', name: 'SiSu-Pro', owned_by: 'sisu' },
        ],
      }),
      text: async () => '',
    }
  })
  try {
    const name = await resolveRuntimeModel(http)
    expect(name).toBe('sisu-lite')
    expect(name).not.toBe('sisu-default')
    expect(readSession().last_model).toBe('sisu-lite')
    expect(http).toHaveBeenCalledTimes(1)
  } finally {
    if (previous === undefined) delete process.env.SISU_HOME
    else process.env.SISU_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})
