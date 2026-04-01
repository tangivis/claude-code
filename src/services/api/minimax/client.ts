/**
 * MiniMax API 客户端
 *
 * 职责：
 *   1. 发送请求到 MiniMax OpenAI 兼容端点
 *   2. 处理流式 SSE 响应
 *   3. 将响应转换为 Anthropic BetaRawMessageStreamEvent 格式的 async iterable
 *
 * 设计决策：
 *   不依赖 OpenAI SDK，直接用 fetch + SSE 解析。
 *   原因：避免额外依赖，MiniMax 的 SSE 格式简单且稳定。
 */

import {
  convertToolsToOpenAI,
  convertMessagesToOpenAI,
  convertSystemPromptToOpenAI,
  parseOpenAIStreamChunk,
  parseOpenAIResponse,
  createStreamState,
  type AnthropicTool,
  type OpenAIChatResponse,
  type OpenAIStreamChunk,
} from './adapter.js'

// ============================================================
// 配置
// ============================================================

const MINIMAX_BASE_URL = 'https://api.minimax.chat/v1'
const DEFAULT_MODEL = 'MiniMax-M2.7'

export function getMinimaxConfig() {
  return {
    apiKey: process.env.MINIMAX_API_KEY || '',
    baseUrl: process.env.MINIMAX_BASE_URL || MINIMAX_BASE_URL,
    model: process.env.MINIMAX_MODEL || DEFAULT_MODEL,
  }
}

// ============================================================
// 请求构建
// ============================================================

/**
 * 将 Anthropic SDK 的 messages.create() 参数转为 MiniMax 请求体。
 *
 * Anthropic params:
 *   { model, messages, system, tools, max_tokens, stream, ... }
 *
 * MiniMax (OpenAI) params:
 *   { model, messages: [system_msg, ...user_msgs], tools, max_tokens, stream }
 */
export function buildMinimaxRequest(params: Record<string, unknown>) {
  const config = getMinimaxConfig()

  // 转换消息
  const anthropicMessages = (params.messages || []) as Array<{ role: string; content: unknown }>
  const openaiMessages = convertMessagesToOpenAI(anthropicMessages)

  // 注入 system prompt
  const systemMsg = convertSystemPromptToOpenAI(params.system)
  const allMessages = systemMsg ? [systemMsg, ...openaiMessages] : openaiMessages

  // 转换工具
  const tools = convertToolsToOpenAI(params.tools as AnthropicTool[] | undefined)

  const body: Record<string, unknown> = {
    model: config.model,
    messages: allMessages,
    max_tokens: params.max_tokens ?? 4096,
    stream: params.stream ?? true,
  }

  if (tools.length > 0) {
    body.tools = tools
  }

  return body
}

// ============================================================
// SSE 解析器
// ============================================================

/**
 * 解析 SSE 文本流，提取 data: 行的 JSON。
 *
 * SSE 格式：
 *   data: {"id":"...","choices":[...]}
 *   data: {"id":"...","choices":[...]}
 *   data: [DONE]
 */
async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OpenAIStreamChunk> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''  // 最后一行可能不完整

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk
          yield json
        } catch {
          // 忽略解析失败的行
        }
      }
    }
  }

  // 处理 buffer 中剩余内容
  if (buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
    try {
      const json = JSON.parse(buffer.trim().slice(6)) as OpenAIStreamChunk
      yield json
    } catch {
      // ignore
    }
  }
}

// ============================================================
// 流式请求
// ============================================================

/**
 * 向 MiniMax 发送流式请求，返回 Anthropic 格式的事件 async iterable。
 *
 * 这个函数是整个 adapter 的核心入口。它被 claude.ts 中的
 * queryModel() 调用，替代 anthropic.beta.messages.create()。
 *
 * 返回的 iterable 产出的事件与 Anthropic SDK 的 Stream<BetaRawMessageStreamEvent>
 * 格式完全一致，所以下游代码（工具处理、UI 渲染等）不需要任何修改。
 */
export async function* streamMinimaxRequest(
  params: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const config = getMinimaxConfig()

  if (!config.apiKey) {
    throw new Error(
      'MINIMAX_API_KEY environment variable is required. ' +
      'Get your key from https://platform.minimaxi.com/',
    )
  }

  const body = buildMinimaxRequest({ ...params, stream: true })

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorDetail = errorText
    try {
      const errorJson = JSON.parse(errorText)
      errorDetail = errorJson.base_resp?.status_msg || errorJson.error?.message || errorText
    } catch {}
    throw new Error(`MiniMax API error (${response.status}): ${errorDetail}`)
  }

  if (!response.body) {
    throw new Error('MiniMax API returned no response body')
  }

  const reader = response.body.getReader()
  const state = createStreamState()

  for await (const chunk of parseSSEStream(reader)) {
    const events = parseOpenAIStreamChunk(chunk, state)
    for (const event of events) {
      yield event
    }
  }
}

// ============================================================
// 非流式请求（用于简单场景）
// ============================================================

export async function callMinimaxNonStreaming(
  params: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const config = getMinimaxConfig()

  if (!config.apiKey) {
    throw new Error('MINIMAX_API_KEY environment variable is required.')
  }

  const body = buildMinimaxRequest({ ...params, stream: false })

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`MiniMax API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as OpenAIChatResponse
  return parseOpenAIResponse(data)
}
