/**
 * MiniMax Anthropic SDK 代理
 *
 * 核心思路：创建一个假的 Anthropic 客户端对象，实现 beta.messages.create() 接口。
 * 当 claude.ts 调用 anthropic.beta.messages.create({...params, stream: true})
 * 时，代理拦截请求，转发给 MiniMax API，并返回一个兼容的 Stream 对象。
 *
 * 这种方式的优势：claude.ts 的 3000+ 行代码完全不需要修改，
 * 所有流式事件处理、工具调用、消息组装都走原始逻辑。
 */
import type Anthropic from '@anthropic-ai/sdk'
import {
  convertToolsToOpenAI,
  convertMessagesToOpenAI,
  convertSystemPromptToOpenAI,
  parseOpenAIStreamChunk,
  createStreamState,
  type OpenAIStreamChunk,
} from './adapter.js'

const MINIMAX_BASE_URL = 'https://api.minimax.chat/v1'
const DEFAULT_MODEL = 'MiniMax-M2.7'

/**
 * 创建一个伪装成 Anthropic SDK 客户端的 MiniMax 代理。
 *
 * claude.ts 只用到两个关键方法：
 *   1. anthropic.beta.messages.create({...params, stream: true}, options).withResponse()
 *   2. 返回的 stream 是 AsyncIterable<BetaRawMessageStreamEvent>
 *
 * 我们只需要代理这两个接口。
 */
export function createMinimaxProxy(): Anthropic {
  const apiKey = process.env.MINIMAX_API_KEY || ''
  const baseUrl = process.env.MINIMAX_BASE_URL || MINIMAX_BASE_URL
  const model = process.env.MINIMAX_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    throw new Error(
      'MINIMAX_API_KEY is required. Get your key from https://platform.minimaxi.com/',
    )
  }

  // 创建代理对象
  const proxy = {
    beta: {
      messages: {
        create(params: any, options?: any) {
          // create() 返回一个 thenable 对象，有 .withResponse() 方法
          // claude.ts 调用方式：
          //   const result = await anthropic.beta.messages.create({...}, {...}).withResponse()
          //   stream = result.data  (AsyncIterable)
          //   requestId = result.request_id

          const streamPromise = doMinimaxStream(params, options?.signal, {
            apiKey, baseUrl, model,
          })

          return {
            // .withResponse() 返回 { data: stream, request_id, response }
            withResponse: async () => {
              const stream = await streamPromise
              return {
                data: stream,
                request_id: `minimax-${Date.now()}`,
                response: new Response(null, { status: 200 }),
              }
            },
            // 也支持直接 await（claude.ts 有时不用 .withResponse()）
            then: (resolve: any, reject: any) => {
              streamPromise.then(resolve, reject)
            },
          }
        },
      },
    },
  } as unknown as Anthropic

  return proxy
}

/**
 * 向 MiniMax 发送流式请求，返回一个兼容 Anthropic Stream 的 AsyncIterable。
 *
 * 关键：返回的对象需要同时是 AsyncIterable 和有 controller 属性
 * （claude.ts 用 'controller' in stream 来判断是否是 stream vs error message）
 */
async function doMinimaxStream(
  params: any,
  signal: AbortSignal | undefined,
  config: { apiKey: string; baseUrl: string; model: string },
) {
  // 转换参数
  const openaiMessages = convertMessagesToOpenAI(params.messages || [])
  const systemMsg = convertSystemPromptToOpenAI(params.system)
  const allMessages = systemMsg ? [systemMsg, ...openaiMessages] : openaiMessages
  const tools = convertToolsToOpenAI(params.tools)

  const body: Record<string, unknown> = {
    model: config.model,
    messages: allMessages,
    max_tokens: params.max_tokens ?? 4096,
    stream: true,
  }
  if (tools.length > 0) {
    body.tools = tools
  }

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
    let detail = errorText
    try {
      const j = JSON.parse(errorText)
      detail = j.base_resp?.status_msg || j.error?.message || errorText
    } catch {}
    throw Object.assign(
      new Error(`MiniMax API error (${response.status}): ${detail}`),
      { status: response.status },
    )
  }

  if (!response.body) {
    throw new Error('MiniMax API returned no response body')
  }

  // 创建一个 AsyncIterable 代理，产出 Anthropic 格式事件
  const reader = response.body.getReader()
  const state = createStreamState()

  const stream = {
    controller: { abort() { reader.cancel() } },
    [Symbol.asyncIterator]() {
      let buffer = ''
      const decoder = new TextDecoder()
      let eventQueue: any[] = []
      let done = false

      return {
        async next(): Promise<IteratorResult<any>> {
          // 先消费队列中的事件
          while (eventQueue.length === 0 && !done) {
            const result = await reader.read()
            if (result.done) {
              done = true
              break
            }

            buffer += decoder.decode(result.value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || trimmed === 'data: [DONE]') continue
              if (trimmed.startsWith('data: ')) {
                try {
                  const chunk = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk
                  const events = parseOpenAIStreamChunk(chunk, state)
                  eventQueue.push(...events)
                } catch {
                  // 忽略解析失败
                }
              }
            }
          }

          if (eventQueue.length > 0) {
            return { value: eventQueue.shift(), done: false }
          }
          return { value: undefined, done: true }
        },
      }
    },
  }

  return stream
}
