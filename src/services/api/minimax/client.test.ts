/**
 * MiniMax Client 集成测试
 *
 * 测试 buildMinimaxRequest 请求构建和实际 API 调用（需要 MINIMAX_API_KEY）
 */
import { describe, test, expect } from 'bun:test'
import { buildMinimaxRequest, getMinimaxConfig } from './client.js'

describe('getMinimaxConfig', () => {
  test('reads config from environment', () => {
    const config = getMinimaxConfig()
    expect(config.baseUrl).toBe(process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1')
    expect(config.model).toBe(process.env.MINIMAX_MODEL || 'MiniMax-M2.7')
  })
})

describe('buildMinimaxRequest', () => {
  test('builds basic request with messages', () => {
    const result = buildMinimaxRequest({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      system: 'You are helpful.',
      max_tokens: 100,
      stream: true,
    })

    expect(result.model).toBe(process.env.MINIMAX_MODEL || 'MiniMax-M2.7')
    expect(result.stream).toBe(true)
    expect(result.max_tokens).toBe(100)

    const messages = result.messages as Array<{ role: string; content: string }>
    // First message should be system
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toBe('You are helpful.')
    // Second should be user
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toBe('hello')
  })

  test('includes tools when provided', () => {
    const result = buildMinimaxRequest({
      messages: [{ role: 'user', content: 'list files' }],
      tools: [
        {
          name: 'Bash',
          description: 'Run a command',
          input_schema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      ],
    })

    expect(result.tools).toBeDefined()
    const tools = result.tools as Array<{ type: string; function: { name: string } }>
    expect(tools[0]!.type).toBe('function')
    expect(tools[0]!.function.name).toBe('Bash')
  })

  test('omits tools when empty', () => {
    const result = buildMinimaxRequest({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    })
    expect(result.tools).toBeUndefined()
  })
})

// 实际 API 调用测试（需要 MINIMAX_API_KEY 环境变量）
describe('MiniMax API integration', () => {
  const hasKey = !!process.env.MINIMAX_API_KEY

  test.skipIf(!hasKey)('non-streaming call returns valid response', async () => {
    const { callMinimaxNonStreaming } = await import('./client.js')
    const events = await callMinimaxNonStreaming({
      messages: [{ role: 'user', content: 'say hello in one word' }],
      max_tokens: 20,
    })

    expect(events.length).toBeGreaterThan(0)
    // Should have message_start
    expect(events.some(e => e.type === 'message_start')).toBe(true)
    // Should have message_stop
    expect(events.some(e => e.type === 'message_stop')).toBe(true)
    // Should have text content
    expect(events.some(e => e.type === 'content_block_delta')).toBe(true)
  })

  test.skipIf(!hasKey)('streaming call yields events', async () => {
    const { streamMinimaxRequest } = await import('./client.js')
    const events: Array<Record<string, unknown>> = []

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    try {
      for await (const event of streamMinimaxRequest({
        messages: [{ role: 'user', content: 'say hi in one word, no thinking' }],
        max_tokens: 100,
      }, controller.signal)) {
        events.push(event)
      }
    } finally {
      clearTimeout(timeout)
    }

    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.type === 'message_start')).toBe(true)
    expect(events.some(e => e.type === 'content_block_delta')).toBe(true)
  }, 20000)

  test.skipIf(!hasKey)('tool calling works', async () => {
    const { callMinimaxNonStreaming } = await import('./client.js')
    const events = await callMinimaxNonStreaming({
      messages: [{ role: 'user', content: 'what is the weather in tokyo?' }],
      tools: [{
        name: 'get_weather',
        description: 'Get weather for a city',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      }],
      max_tokens: 200,
    })

    // Should have a tool_use content block
    const toolStart = events.find(
      e => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    )
    expect(toolStart).toBeDefined()
    expect((toolStart as any).content_block.name).toBe('get_weather')
  })
})
