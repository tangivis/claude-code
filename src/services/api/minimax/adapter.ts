/**
 * MiniMax Adapter
 *
 * 将 Anthropic SDK 的请求/响应格式与 MiniMax(OpenAI 兼容) 格式互转。
 *
 * 设计思路：
 *   Claude Code 的整个下游（工具执行、UI 渲染、消息管理）都期望 Anthropic 格式的
 *   BetaRawMessageStreamEvent。我们不修改下游，而是在 API 调用层做格式转换：
 *
 *   Anthropic 请求参数 → [convertToOpenAI] → MiniMax API → [parseToAnthropic] → Anthropic 事件流
 *
 * 格式对比：
 *   Anthropic tools:  { name, description, input_schema }
 *   OpenAI tools:     { type:'function', function:{ name, description, parameters } }
 *
 *   Anthropic tool_use:    { type:'tool_use', id, name, input:{...} }
 *   OpenAI tool_calls:     { id, type:'function', function:{ name, arguments:'...' } }
 *
 *   Anthropic stream:  message_start → content_block_start → content_block_delta → content_block_stop → message_delta → message_stop
 *   OpenAI stream:     data: {"choices":[{"delta":{"content":"..."}}]}  →  data: [DONE]
 */

// ============================================================
// 类型定义
// ============================================================

/** Anthropic 工具定义格式 */
export type AnthropicTool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** OpenAI 工具定义格式 */
export type OpenAITool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** OpenAI 消息格式 */
export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

/** OpenAI 非流式响应 */
export type OpenAIChatResponse = {
  id: string
  model: string
  choices: Array<{
    index: number
    finish_reason: string | null
    message: {
      role: string
      content?: string | null
      tool_calls?: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>
    }
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

/** OpenAI 流式 chunk */
export type OpenAIStreamChunk = {
  id: string
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: OpenAIChatResponse['usage']
}

/** 流式解析的状态跟踪 */
export type StreamState = {
  blockIndex: number       // 当前 content block 索引
  started: boolean         // message_start 是否已发送
  toolCallIds: Map<number, string>  // tool_call index → id 映射
  toolCallNames: Map<number, string> // tool_call index → name 映射
  inThinkBlock: boolean    // 是否在 <think>...</think> 块内
  hasYieldedText: boolean  // 是否已经产出过 text content_block_start
}

export function createStreamState(): StreamState {
  return { blockIndex: 0, started: false, toolCallIds: new Map(), toolCallNames: new Map(), inThinkBlock: false, hasYieldedText: false }
}

// ============================================================
// 1. 工具格式转换：Anthropic → OpenAI
// ============================================================

/**
 * 将 Anthropic 工具定义转为 OpenAI function calling 格式。
 *
 * 转换规则：
 *   Anthropic: { name, description, input_schema: { type:'object', properties, required } }
 *   OpenAI:    { type:'function', function: { name, description, parameters: { ... } } }
 *
 * input_schema 和 parameters 内容完全相同，只是外层包装不同。
 */
export function convertToolsToOpenAI(
  tools: AnthropicTool[] | undefined,
): OpenAITool[] {
  if (!tools || tools.length === 0) return []
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

// ============================================================
// 2. 消息格式转换：Anthropic → OpenAI
// ============================================================

/**
 * 将 Anthropic 消息数组转为 OpenAI 格式。
 *
 * 复杂点在于：
 * - Anthropic 的 content 可以是 string 或 ContentBlock[]
 * - tool_use blocks 要转成 tool_calls
 * - tool_result 要转成 role:'tool' 的独立消息
 */
export function convertMessagesToOpenAI(
  messages: Array<{ role: string; content: unknown }>,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const msg of messages) {
    // String content — 简单消息
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as OpenAIMessage['role'], content: msg.content })
      continue
    }

    // Array content — Anthropic content blocks
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as Array<Record<string, unknown>>

      // 检查是否包含 tool_result（这些需要转成独立的 tool role 消息）
      const toolResults = blocks.filter(b => b.type === 'tool_result')
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const content = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? (tr.content as Array<Record<string, unknown>>)
                  .filter(c => c.type === 'text')
                  .map(c => c.text)
                  .join('\n')
              : JSON.stringify(tr.content ?? '')
          result.push({
            role: 'tool',
            content,
            tool_call_id: tr.tool_use_id as string,
          })
        }
        continue
      }

      // Assistant message with mixed content (text + tool_use)
      const textParts: string[] = []
      const toolCalls: OpenAIMessage['tool_calls'] = []

      for (const block of blocks) {
        if (block.type === 'text') {
          textParts.push(block.text as string)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id as string,
            type: 'function',
            function: {
              name: block.name as string,
              arguments: JSON.stringify(block.input),
            },
          })
        }
        // thinking blocks 跳过（MiniMax 有自己的 reasoning）
      }

      const openAIMsg: OpenAIMessage = {
        role: msg.role as OpenAIMessage['role'],
        content: textParts.join('\n') || null,
      }
      if (toolCalls.length > 0) {
        openAIMsg.tool_calls = toolCalls
      }
      result.push(openAIMsg)
    }
  }

  return result
}

// ============================================================
// 3. System prompt 转换
// ============================================================

/**
 * 将 Anthropic system prompt（string 或 text block 数组）转为 OpenAI system message。
 */
export function convertSystemPromptToOpenAI(
  system: unknown,
): OpenAIMessage | null {
  if (!system) return null
  if (typeof system === 'string') {
    if (!system.trim()) return null
    return { role: 'system', content: system }
  }
  if (Array.isArray(system)) {
    const text = (system as Array<Record<string, unknown>>)
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
    if (!text.trim()) return null
    return { role: 'system', content: text }
  }
  return null
}

// ============================================================
// 4. 非流式响应解析：OpenAI → Anthropic 事件序列
// ============================================================

/**
 * 将 MiniMax 的非流式响应转为 Anthropic BetaRawMessageStreamEvent 序列。
 *
 * Anthropic 流式事件顺序：
 *   1. message_start    — 初始消息元数据
 *   2. content_block_start  — 每个 content block 开始
 *   3. content_block_delta  — content block 内容增量
 *   4. content_block_stop   — content block 结束
 *   5. message_delta    — 结束原因、usage
 *   6. message_stop     — 消息结束
 */
export function parseOpenAIResponse(response: OpenAIChatResponse): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  const choice = response.choices[0]
  if (!choice) return events
  const message = choice.message

  // 1. message_start
  events.push({
    type: 'message_start',
    message: {
      id: response.id,
      type: 'message',
      role: 'assistant',
      model: response.model,
      content: [],
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  })

  let blockIndex = 0

  // 2. Text content (strip <think>...</think> reasoning blocks from MiniMax)
  let textContent = message.content || ''
  textContent = textContent.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  if (textContent) {
    events.push({
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    })
    events.push({
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'text_delta', text: textContent },
    })
    events.push({ type: 'content_block_stop', index: blockIndex })
    blockIndex++
  }

  // 3. Tool calls
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      let parsedInput: unknown
      try {
        parsedInput = JSON.parse(tc.function.arguments)
      } catch {
        parsedInput = {}
      }

      events.push({
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: {},
        },
      })
      events.push({
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: tc.function.arguments,
        },
      })
      events.push({ type: 'content_block_stop', index: blockIndex })
      blockIndex++
    }
  }

  // 4. message_delta (stop reason + usage)
  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: mapFinishReason(choice.finish_reason),
    },
    usage: {
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  })

  // 5. message_stop
  events.push({ type: 'message_stop' })

  return events
}

// ============================================================
// 5. 流式 chunk 解析：OpenAI SSE → Anthropic 事件
// ============================================================

/**
 * 将单个 OpenAI 流式 chunk 转为 Anthropic 事件序列。
 *
 * OpenAI 流式格式：
 *   data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
 *   data: [DONE]
 *
 * 需要跟踪状态（哪些 block 已经开始了）来生成正确的 Anthropic 事件。
 */
export function parseOpenAIStreamChunk(
  chunk: OpenAIStreamChunk,
  state: StreamState,
): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  const choice = chunk.choices?.[0]
  if (!choice) return events

  // 首次收到 chunk 时发送 message_start
  if (!state.started) {
    events.push({
      type: 'message_start',
      message: {
        id: chunk.id,
        type: 'message',
        role: 'assistant',
        model: chunk.model,
        content: [],
        usage: {
          input_tokens: chunk.usage?.prompt_tokens ?? 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    })
    state.started = true
  }

  const delta = choice.delta

  // Text content delta
  if (delta.content) {
    // MiniMax M2.7 会返回 <think>...</think> 标签包裹的推理内容
    // 过滤掉这些内容，只保留实际回复
    let text = delta.content
    // 移除 <think> 标签及其内容（可能跨多个 chunk，用状态跟踪）
    if (text.includes('<think>')) {
      state.inThinkBlock = true
    }
    if (state.inThinkBlock) {
      const endIdx = text.indexOf('</think>')
      if (endIdx !== -1) {
        text = text.slice(endIdx + '</think>'.length)
        state.inThinkBlock = false
      } else {
        text = '' // 仍在 think block 内，丢弃
      }
    }
    // 清理开头的换行（think block 之后可能有多余换行）
    if (text && !state.hasYieldedText) {
      text = text.replace(/^\n+/, '')
    }

    if (text) {
      // 如果是第一次收到文本，先发 content_block_start
      if (!state.hasYieldedText) {
        events.push({
          type: 'content_block_start',
          index: state.blockIndex,
          content_block: { type: 'text', text: '' },
        })
        state.hasYieldedText = true
      }
      events.push({
        type: 'content_block_delta',
        index: state.blockIndex,
        delta: { type: 'text_delta', text },
      })
    }
  }

  // Tool calls delta
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const tcIndex = tc.index

      // 新的 tool_call 开始（有 id 表示新 tool_call）
      if (tc.id) {
        // 先关闭之前的 text block（如果有的话）
        if (state.blockIndex > 0 || events.some(e => e.type === 'content_block_delta')) {
          events.push({ type: 'content_block_stop', index: state.blockIndex })
          state.blockIndex++
        }

        state.toolCallIds.set(tcIndex, tc.id)
        if (tc.function?.name) {
          state.toolCallNames.set(tcIndex, tc.function.name)
        }

        events.push({
          type: 'content_block_start',
          index: state.blockIndex,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name ?? '',
            input: {},
          },
        })
      }

      // Tool call arguments 增量
      if (tc.function?.arguments) {
        events.push({
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: tc.function.arguments,
          },
        })
      }
    }
  }

  // Finish reason
  if (choice.finish_reason) {
    // 关闭当前 block
    events.push({ type: 'content_block_stop', index: state.blockIndex })

    // message_delta with stop reason
    events.push({
      type: 'message_delta',
      delta: {
        stop_reason: mapFinishReason(choice.finish_reason),
      },
      usage: {
        output_tokens: chunk.usage?.completion_tokens ?? 0,
      },
    })

    // message_stop
    events.push({ type: 'message_stop' })
  }

  return events
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * OpenAI finish_reason → Anthropic stop_reason 映射
 */
function mapFinishReason(reason: string | null): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}
