import { clientStamp } from '../client'
import type { HttpClient } from '../http'
import {
  buildCompleteRequest,
  completeUrl,
  createSisuCloudModel,
  isServerSideAgentPayload,
  parseCompleteSse,
  parseOpenAiChatCompletion,
  toProviderMessages,
} from './adapter'
import { localToolDefinitions } from './tools'
import type { ModelRequest } from './types'

const request: ModelRequest = {
  model: 'kimi-k2.5',
  messages: [
    { role: 'user', content: 'read hello.txt' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', name: 'read_file', arguments: { target_file: 'hello.txt' } }],
    },
    { role: 'tool', tool_call_id: 'c1', name: 'read_file', content: 'hello sisu' },
  ],
  tools: localToolDefinitions(),
}

it('builds a messages+tools complete payload, not /api/chat/send coding', () => {
  const body = buildCompleteRequest(request, { client: 'cli' })
  expect(completeUrl('https://www.sisu.chat')).toBe('https://www.sisu.chat/api/runtime/complete')
  expect(body.model).toBe('kimi-k2.5')
  expect(body.messages).toEqual(toProviderMessages(request.messages))
  expect(body.messages[1].tool_calls).toEqual([
    {
      id: 'c1',
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ target_file: 'hello.txt' }) },
    },
  ])
  expect(body.tools.map((tool) => tool.function.name)).toEqual(['read_file', 'search_replace', 'grep', 'bash'])
  expect(body.client).toBe('cli')
  expect(body.client_version).toBe(clientStamp('cli').client_version)
  expect(body.client_request_id).toBeTruthy()
  expect(isServerSideAgentPayload(body)).toBe(false)
  expect(isServerSideAgentPayload({ task_category: 'coding', message: 'hi' })).toBe(true)
  expect((body as { task_category?: string }).task_category).toBeUndefined()
  expect((body as { message?: string }).message).toBeUndefined()
})

it('parses streamed text and tool_calls from the complete wire', () => {
  const parsed = parseCompleteSse(
    [
      'event: text',
      'data: "looking\\n"',
      '',
      'event: tool_call',
      'data: {"id":"c9","name":"grep","arguments":{"pattern":"sisu"}}',
      '',
    ].join('\n'),
  )
  expect(parsed.text).toContain('looking')
  expect(parsed.tool_calls).toEqual([{ id: 'c9', name: 'grep', arguments: { pattern: 'sisu' } }])
})

it('parses an OpenAI-shaped completion with function tool_calls', () => {
  const parsed = parseOpenAiChatCompletion({
    choices: [
      {
        message: {
          content: 'ok',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"ls"}' },
            },
          ],
        },
      },
    ],
  })
  expect(parsed).toEqual({
    text: 'ok',
    tool_calls: [{ id: 'call_1', name: 'bash', arguments: { command: 'ls' } }],
  })
})

it('createSisuCloudModel posts the real complete payload and parses the response', async () => {
  const seen: Array<{ url: string; body: string }> = []
  const http = jest.fn(async (url: string, init?: { body?: string }) => {
    seen.push({ url, body: String(init?.body || '') })
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => 'event: tool_call\ndata: {"id":"c2","name":"read_file","arguments":{"target_file":"a.ts"}}\n\n',
    }
  })
  const model = createSisuCloudModel(http as unknown as HttpClient, {
    apiBase: 'https://www.sisu.chat',
    token: 'jwt',
    client: 'tui',
  })
  const completion = await model.complete(request)
  expect(seen[0].url).toBe('https://www.sisu.chat/api/runtime/complete')
  expect(seen[0].url).not.toContain('/api/chat/send')
  const payload = JSON.parse(seen[0].body)
  expect(payload.messages).toEqual(toProviderMessages(request.messages))
  expect(payload.messages[1].tool_calls[0].function.arguments).toBe(
    JSON.stringify({ target_file: 'hello.txt' }),
  )
  expect(payload.tools.length).toBe(4)
  expect(payload.task_category).toBeUndefined()
  expect(completion.tool_calls[0]).toEqual({
    id: 'c2',
    name: 'read_file',
    arguments: { target_file: 'a.ts' },
  })
})

it('follow-up complete after a tool result uses OpenAI function tool_calls', async () => {
  const seen: string[] = []
  const http = jest.fn(async (_url: string, init?: { body?: string }) => {
    seen.push(String(init?.body || ''))
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => 'event: text\ndata: "done"\n\n',
    }
  })
  const model = createSisuCloudModel(http as unknown as HttpClient, {
    apiBase: 'https://www.sisu.chat',
    token: 'jwt',
    client: 'cli',
  })
  await model.complete(request)
  const payload = JSON.parse(seen[0])
  const assistant = payload.messages[1]
  expect(assistant.role).toBe('assistant')
  expect(assistant.tool_calls[0]).toEqual({
    id: 'c1',
    type: 'function',
    function: { name: 'read_file', arguments: '{"target_file":"hello.txt"}' },
  })
  expect(typeof assistant.tool_calls[0].function.arguments).toBe('string')
  expect(payload.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: 'hello sisu' })
})
