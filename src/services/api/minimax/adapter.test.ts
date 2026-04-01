/**
 * MiniMax Adapter 测试
 *
 * 测试策略：验证 Anthropic ↔ OpenAI(MiniMax) 格式转换的正确性
 *
 * MiniMax 使用 OpenAI 兼容 API 格式：
 *   - 请求：{ model, messages: [{role, content}], tools: [{type:'function', function:{...}}] }
 *   - 响应：{ choices: [{message: {content, tool_calls}}], usage: {...} }
 *   - 流式：data: {"choices":[{"delta":{...}}]}
 *
 * Anthropic 格式：
 *   - 请求：{ model, messages, system, tools: [{name, description, input_schema}] }
 *   - 流式事件：message_start, content_block_start, content_block_delta, message_delta, message_stop
 */
import { describe, test, expect } from 'bun:test'
import {
  convertToolsToOpenAI,
  convertMessagesToOpenAI,
  convertSystemPromptToOpenAI,
  parseOpenAIResponse,
  parseOpenAIStreamChunk,
  type OpenAIChatResponse,
  type OpenAIStreamChunk,
  createStreamState,
} from './adapter.js'

// ============================================================
// 1. 工具格式转换测试
// ============================================================
describe('convertToolsToOpenAI', () => {
  test('converts Anthropic tool schema to OpenAI function format', () => {
    const anthropicTools = [
      {
        name: 'Bash',
        description: 'Execute a bash command',
        input_schema: {
          type: 'object' as const,
          properties: {
            command: { type: 'string', description: 'The command to run' },
          },
          required: ['command'],
        },
      },
    ]

    const result = convertToolsToOpenAI(anthropicTools)

    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'Bash',
          description: 'Execute a bash command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The command to run' },
            },
            required: ['command'],
          },
        },
      },
    ])
  })

  test('handles empty tools array', () => {
    expect(convertToolsToOpenAI([])).toEqual([])
  })

  test('handles undefined tools', () => {
    expect(convertToolsToOpenAI(undefined)).toEqual([])
  })
})

// ============================================================
// 2. 消息格式转换测试
// ============================================================
describe('convertMessagesToOpenAI', () => {
  test('converts simple user message', () => {
    const messages = [
      { role: 'user' as const, content: 'hello' },
    ]
    const result = convertMessagesToOpenAI(messages)
    expect(result).toEqual([{ role: 'user', content: 'hello' }])
  })

  test('converts assistant message with text content blocks', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'hi there' }],
      },
    ]
    const result = convertMessagesToOpenAI(messages)
    expect(result[0]!.role).toBe('assistant')
    expect(result[0]!.content).toBe('hi there')
  })

  test('converts assistant message with tool_use to tool_calls', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'Let me check.' },
          {
            type: 'tool_use' as const,
            id: 'tool_123',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
    ]
    const result = convertMessagesToOpenAI(messages)
    expect(result[0]!.role).toBe('assistant')
    expect(result[0]!.content).toBe('Let me check.')
    expect(result[0]!.tool_calls).toEqual([
      {
        id: 'tool_123',
        type: 'function',
        function: { name: 'Bash', arguments: '{"command":"ls"}' },
      },
    ])
  })

  test('converts tool_result to tool role message', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_123',
            content: 'file1.ts\nfile2.ts',
          },
        ],
      },
    ]
    const result = convertMessagesToOpenAI(messages)
    expect(result[0]!.role).toBe('tool')
    expect(result[0]!.tool_call_id).toBe('tool_123')
    expect(result[0]!.content).toBe('file1.ts\nfile2.ts')
  })
})

// ============================================================
// 3. System prompt 转换测试
// ============================================================
describe('convertSystemPromptToOpenAI', () => {
  test('converts string system prompt', () => {
    const result = convertSystemPromptToOpenAI('You are a helpful assistant.')
    expect(result).toEqual({ role: 'system', content: 'You are a helpful assistant.' })
  })

  test('converts array system prompt blocks', () => {
    const result = convertSystemPromptToOpenAI([
      { type: 'text', text: 'Block 1.' },
      { type: 'text', text: 'Block 2.' },
    ])
    expect(result).toEqual({ role: 'system', content: 'Block 1.\nBlock 2.' })
  })

  test('returns null for empty/undefined', () => {
    expect(convertSystemPromptToOpenAI(undefined)).toBeNull()
    expect(convertSystemPromptToOpenAI('')).toBeNull()
  })
})

// ============================================================
// 4. 非流式响应解析测试
// ============================================================
describe('parseOpenAIResponse', () => {
  test('parses text-only response into Anthropic events', () => {
    const response: OpenAIChatResponse = {
      id: 'resp_1',
      model: 'MiniMax-M2.7',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Hello world' },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }

    const events = parseOpenAIResponse(response)

    // Should produce: message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
    const types = events.map(e => e.type)
    expect(types).toContain('message_start')
    expect(types).toContain('content_block_start')
    expect(types).toContain('content_block_delta')
    expect(types).toContain('message_stop')

    // Check text content
    const delta = events.find(e => e.type === 'content_block_delta')
    expect((delta as any).delta.text).toBe('Hello world')
  })

  test('parses tool_calls response into Anthropic tool_use events', () => {
    const response: OpenAIChatResponse = {
      id: 'resp_2',
      model: 'MiniMax-M2.7',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'Bash', arguments: '{"command":"ls"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }

    const events = parseOpenAIResponse(response)
    const toolStart = events.find(
      e => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    )
    expect(toolStart).toBeDefined()
    expect((toolStart as any).content_block.name).toBe('Bash')
    expect((toolStart as any).content_block.id).toBe('call_1')
  })

  test('maps finish_reason correctly', () => {
    const response: OpenAIChatResponse = {
      id: 'resp_3',
      model: 'MiniMax-M2.7',
      choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: 'truncated' } }],
      usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
    }

    const events = parseOpenAIResponse(response)
    const messageDelta = events.find(e => e.type === 'message_delta')
    expect((messageDelta as any).delta.stop_reason).toBe('max_tokens')
  })
})

// ============================================================
// 5. 流式 chunk 解析测试
// ============================================================
describe('parseOpenAIStreamChunk', () => {
  test('parses text delta chunk', () => {
    const chunk: OpenAIStreamChunk = {
      id: 'chunk_1',
      model: 'MiniMax-M2.7',
      choices: [
        { index: 0, delta: { content: 'Hello' }, finish_reason: null },
      ],
    }

    const events = parseOpenAIStreamChunk(chunk, createStreamState())
    const textDelta = events.find(e => e.type === 'content_block_delta')
    expect(textDelta).toBeDefined()
    expect((textDelta as any).delta.text).toBe('Hello')
  })

  test('parses tool_calls delta chunk', () => {
    const chunk: OpenAIStreamChunk = {
      id: 'chunk_2',
      model: 'MiniMax-M2.7',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"co' } },
            ],
          },
          finish_reason: null,
        },
      ],
    }

    const events = parseOpenAIStreamChunk(chunk, createStreamState())
    const hasToolEvent = events.some(
      e => e.type === 'content_block_start' || e.type === 'content_block_delta',
    )
    expect(hasToolEvent).toBe(true)
  })

  test('parses finish chunk with stop reason', () => {
    const chunk: OpenAIStreamChunk = {
      id: 'chunk_3',
      model: 'MiniMax-M2.7',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }

    const events = parseOpenAIStreamChunk(chunk, createStreamState())
    const hasDelta = events.some(e => e.type === 'message_delta')
    expect(hasDelta).toBe(true)
  })
})
