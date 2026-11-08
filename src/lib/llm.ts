import { classify, coldLine, isCoax, isVenting, warmTail, type Intent } from './engine'
import { buildUserMessage, RETRY_PROMPT, SYSTEM_PROMPT, toneSystem, type LocalHint } from './prompt'
import type { Emotion, Turn } from './types'

export interface ClassifyInput {
  text: string
  current: Emotion
  affinity: number
  /** 最近几轮对话，给模型做上下文 */
  history: Turn[]
  /** 本地规则的初判，作为弱提示写进提示词 */
  hint: LocalHint
}

/**
 * 语义层接口：本地规则引擎与 LLM 适配器实现同一签名，
 * 因此 UI / 状态机 / 动画层完全不需要知道背后是人还是模型。
 */
export interface IntentEngine {
  name: string
  classify(input: ClassifyInput): Promise<Intent>
  /** 流式版本：边生成边把「已成形的那部分 reply」推给 UI */
  stream?(input: ClassifyInput, onDelta: (text: string) => void): Promise<Intent>
}

/** 直连模式（可选）：OpenAI 兼容端点，Key 会进 bundle，仅建议本地临时用 */
const DIRECT_URL = import.meta.env.VITE_LLM_URL as string | undefined
const DIRECT_KEY = import.meta.env.VITE_LLM_KEY as string | undefined
const DIRECT_MODEL = (import.meta.env.VITE_LLM_MODEL as string | undefined) ?? 'gpt-4o-mini'

/** 代理模式（默认）：同源 /api/chat，由 vite 把请求转给智谱，Key 留在服务端 */
const PROXY_URL = '/api/chat'
const STREAM_URL = '/api/chat/stream'
/** glm-4-flash 首字有时要 6–9 秒，给足余量 */
const TIMEOUT = 12000
const STREAM_TIMEOUT = 25000

export type EngineMode = 'local' | 'llm'

export interface EngineInfo {
  mode: EngineMode
  label: string
}

let info: EngineInfo = { mode: 'local', label: 'local-rules' }

export function getEngineInfo(): EngineInfo {
  return info
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isEmotion(value: unknown): value is Emotion {
  return (
    value === 'idle' ||
    value === 'happy' ||
    value === 'sad' ||
    value === 'angry' ||
    value === 'sleepy'
  )
}

/** 只输出省略号 / 空 / 过长，都算不合格，交给本地规则兜底 */
function isValidReply(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (/^[.。…·~～!！?？,，、\s]+$/.test(value)) return false
  return value.length <= 60
}

/**
 * 产品规则兜底：情绪是「晓」的状态，不是用户的状态。
 * 用户说自己累/困/加班，模型偶尔还是会判成 sleepy —— 这里强制拉回 idle，
 * 除非这句话同时是在哄它睡（「哄你睡觉」「晚安」）。
 */
const USER_TIRED = /(我.{0,4}(累|困|疲惫|困倦)|累死|加班|熬夜|失眠|撑不住)/
const SLEEP_COMMAND = /(哄|陪你睡|一起睡|晚安|去睡|该睡)/

function resolveEmotion(emotion: Emotion | null, hint: string, text: string): Emotion | null {
  let value = emotion ?? (isEmotion(hint) ? hint : null)
  if (!value) return null
  /* 他在诉苦 → 晓不能跟着难过或生气，回到 idle 去心疼他 */
  if (isVenting(text) && (value === 'sad' || value === 'angry')) value = 'idle'
  if (value === 'sleepy' && USER_TIRED.test(text) && !SLEEP_COMMAND.test(text)) {
    value = 'idle'
  }
  return value
}

/**
 * 从「生成到一半的 JSON」里抠出 reply 字段：流式时先用它做打字机，
 * 流结束时再用 parseReply 做一次严格解析。
 */
function extractReply(raw: string): string | null {
  const key = raw.indexOf('"reply"')
  if (key < 0) return null
  let index = raw.indexOf(':', key)
  if (index < 0) return null
  index += 1
  while (index < raw.length && /\s/.test(raw[index])) index += 1
  if (raw[index] !== '"') return null
  index += 1

  let out = ''
  for (; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === '\\') {
      const next = raw[index + 1]
      if (next === undefined) break
      if (next === 'n') {
        out += '\n'
        index += 1
      } else if (next === 't') {
        out += '\t'
        index += 1
      } else if (next === 'u') {
        if (index + 5 >= raw.length) break
        out += String.fromCharCode(parseInt(raw.slice(index + 2, index + 6), 16) || 32)
        index += 5
      } else {
        out += next
        index += 1
      }
      continue
    }
    if (char === '"') return out
    out += char
  }
  return out
}

/**
 * 风格兜底：小模型经常无视「语气随好感度变化」。
 * 低好感度时，只要它还在撒娇/话多，就直接换成冷淡短句；
 * 高好感度时，如果只有一句干巴巴的话，就补一句关心。
 */
const WARM_WORDS = /(呀|呢|哦|啦|嘛|想你|等你|陪你|抱抱|亲亲|宝贝|乖乖)/

function enforceTone(reply: string, affinity: number, text = ''): string {
  /* 对方在道歉 / 哄它：这轮不要套用冷淡模板 */
  if (isCoax(text)) return reply.trim()
  const value = reply.trim()
  if (affinity < 20) {
    if (WARM_WORDS.test(value) || value.length > 16) return coldLine()
    return value
  }
  if (affinity >= 82) {
    if (value.length < 20 && !/[?？]/.test(value)) {
      return `${value.replace(/[。！!…、\s]+$/, '')}，${warmTail()}`
    }
  }
  return value
}

/**
 * 解析模型输出。emotion 允许缺失/写错（例如把枚举原样抄成 "idle|happy|shy|sleepy"）：
 * 只要 reply 可用，就退回本地初判的情绪，避免整句丢掉。
 */
function parseReply(
  content: string,
): { emotion: Emotion | null; confidence: number; reply: string } | null {
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const data = JSON.parse(match[0]) as Record<string, unknown>
    if (typeof data.reply !== 'string') return null
    if (!isValidReply(data.reply)) return null
    const confidence = typeof data.confidence === 'number' ? clamp(data.confidence, 0.3, 0.99) : 0.7
    return {
      emotion: isEmotion(data.emotion) ? data.emotion : null,
      confidence,
      reply: data.reply.trim().slice(0, 60),
    }
  } catch {
    return null
  }
}

/** 模型偶尔直接回一句大白话（不带 JSON）：这句话本身可用，就当成 reply */
function asProseReply(content: string): string | null {
  const value = content.replace(/^["'「]+|["'」]+$/g, '').trim()
  if (!value || value.length > 60) return null
  if (/[{}]/.test(value)) return null
  if (!/[\u4e00-\u9fa5]/.test(value)) return null
  if (/^[.。…·~～!！?？,，、\s]+$/.test(value)) return null
  return value
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } finally {
    window.clearTimeout(timer)
  }
}

function toMessages(input: ClassifyInput) {
  const users = input.history.filter((turn) => turn.role === 'user')
  const pets = input.history.filter((turn) => turn.role !== 'user')
  return [
    { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\n${toneSystem(input.affinity)}` },
    ...input.history.slice(-10).map((turn) => ({
      role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: turn.text,
    })),
    {
      role: 'user' as const,
      content: buildUserMessage(
        input.text,
        input.current,
        input.affinity,
        input.hint,
        users[users.length - 1]?.text,
        pets[pets.length - 1]?.text,
        isCoax(input.text),
      ),
    },
  ]
}

export const localEngine: IntentEngine = {
  name: 'local-rules',
  classify: async ({ text, current, affinity }) => classify(text, current, affinity),
}

async function classifyViaProxy(input: ClassifyInput): Promise<Intent | null> {
  return withTimeout(TIMEOUT, async (signal) => {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        current: input.current,
        affinity: input.affinity,
        hint: input.hint,
        coax: isCoax(input.text),
        history: input.history.slice(-10).map((turn) => ({ role: turn.role, text: turn.text })),
      }),
      signal,
    })
    if (!response.ok) return null
    const data = (await response.json()) as { content?: string; model?: string }
    const model = data.model ?? 'glm'
    const parsed = parseReply(data.content ?? '')
    if (parsed) {
      const emotion = resolveEmotion(parsed.emotion, input.hint.emotion, input.text)
      if (!emotion) return null
      return {
        emotion,
        /* 模型成功给出回复，置信度不该低于「它确实答了」这条下限 */
        confidence: Math.max(parsed.confidence, 0.62),
        reply: enforceTone(parsed.reply, input.affinity, input.text),
        matched: [model],
      }
    }
    /* JSON 没解析出来，但模型给了一句可用的大白话：留着这句话，情绪用本地初判 */
    const prose = asProseReply(data.content ?? '')
    if (prose && isEmotion(input.hint.emotion)) {
      return {
        emotion: input.hint.emotion,
        confidence: Math.min(0.7, input.hint.confidence + 0.2),
        reply: enforceTone(prose, input.affinity),
        matched: [model],
      }
    }
    return null
  }).catch(() => null)
}

async function classifyDirect(input: ClassifyInput): Promise<Intent | null> {
  if (!DIRECT_URL) return null
  return withTimeout(TIMEOUT, async (signal) => {
    const response = await fetch(DIRECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(DIRECT_KEY ? { Authorization: `Bearer ${DIRECT_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: DIRECT_MODEL,
        temperature: 0.8,
        messages: toMessages(input),
      }),
      signal,
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      content?: string
    }
    const content = payload.choices?.[0]?.message?.content ?? payload.content ?? ''
    const parsed = parseReply(content)
    if (!parsed) return null
    const emotion = resolveEmotion(parsed.emotion, input.hint.emotion, input.text)
    if (!emotion) return null
    return {
      emotion,
      confidence: parsed.confidence,
      reply: enforceTone(parsed.reply, input.affinity, input.text),
      matched: [DIRECT_MODEL],
    }
  }).catch(() => null)
}

/**
 * 流式版本：同源 /api/chat/stream（SSE），边生成边回调。
 * 任何一步失败返回 null，上层会自动退回非流式 classify。
 */
async function streamViaProxy(
  input: ClassifyInput,
  onDelta: (text: string) => void,
): Promise<Intent | null> {
  return withTimeout(STREAM_TIMEOUT, async (signal) => {
    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        current: input.current,
        affinity: input.affinity,
        hint: input.hint,
        coax: isCoax(input.text),
        history: input.history.slice(-10).map((turn) => ({ role: turn.role, text: turn.text })),
      }),
      signal,
    })
    if (!response.ok || !response.body) return null

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let raw = ''
    let lastEmitted = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
          const delta = json.choices?.[0]?.delta?.content ?? ''
          if (!delta) continue
          raw += delta
          const partial = extractReply(raw)
          if (partial !== null && partial.length > 0 && partial !== lastEmitted) {
            lastEmitted = partial
            onDelta(partial)
          }
        } catch {
          /* 半包 JSON，等下一块 */
        }
      }
    }

    const parsed = parseReply(raw)
    if (!parsed) return null
    const emotion = resolveEmotion(parsed.emotion, input.hint.emotion, input.text)
    if (!emotion) return null
    return {
      emotion,
      confidence: Math.max(parsed.confidence, 0.62),
      reply: enforceTone(parsed.reply, input.affinity, input.text),
      matched: ['glm'],
    }
  }).catch(() => null)
}

/**
 * 统一入口：能用模型就用模型，任何异常（超时 / 限流 / Key 失效 / 输出不合格 /
 * 静态部署无后端）都静默回退本地规则，保证演示永远不中断。
 */
export const companionEngine: IntentEngine = {
  name: 'companion',
  async classify(input) {
    if (info.mode === 'llm') {
      const result = DIRECT_URL ? await classifyDirect(input) : await classifyViaProxy(input)
      if (result) return result
    }
    return localEngine.classify(input)
  },
  async stream(input, onDelta) {
    if (info.mode === 'llm' && !DIRECT_URL) {
      const result = await streamViaProxy(input, onDelta)
      if (result) return result
    }
    const intent = await companionEngine.classify(input)
    onDelta(intent.reply)
    return intent
  },
}

export function getEngine(): IntentEngine {
  return companionEngine
}

/**
 * 启动时探测一次：有 Key（dev 代理）就切到 glm，没有就维持本地规则。
 * 静态部署没有 /api/chat，探测失败也不会报错。
 */
export async function initEngine(): Promise<EngineInfo> {
  if (DIRECT_URL) {
    info = { mode: 'llm', label: `llm:${DIRECT_MODEL}` }
    return info
  }
  try {
    const probe = await withTimeout(2500, async (signal) => {
      const response = await fetch(PROXY_URL, { signal })
      if (!response.ok) return null
      return (await response.json()) as { ok?: boolean; model?: string }
    })
    if (probe?.ok) {
      info = { mode: 'llm', label: `zhipu:${probe.model ?? 'glm-4-flash'}` }
    }
  } catch {
    /* 静态部署没有 /api/chat：保持 local-rules */
  }
  return info
}

export { RETRY_PROMPT }
