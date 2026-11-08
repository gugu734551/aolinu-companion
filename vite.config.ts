import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import { buildUserMessage, RETRY_PROMPT, SYSTEM_PROMPT, toneSystem } from './src/lib/prompt.ts'

const ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

/** 只有「模型不存在 / 无权限」这类错误才值得换模型重试 */
const MODEL_ERROR = /model|模型|1211|1213|not.?found|invalid|不存在|无权限/i

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** 取最近一条用户消息与最近一条晓的回复，用于显式提示记忆 */
function lastTurns(history: { role?: string; text?: string }[]) {
  const users = history.filter((turn) => turn.role === 'user' && typeof turn.text === 'string')
  const pets = history.filter((turn) => turn.role !== 'user' && typeof turn.text === 'string')
  return {
    lastUser: users[users.length - 1]?.text,
    lastPet: pets[pets.length - 1]?.text,
  }
}

/** 粗略判断模型这次是否给了可用的 JSON（精细校验在前端做） */
function looksUsable(content: string): boolean {
  if (!/\{[\s\S]*"reply"[\s\S]*\}/.test(content)) return false
  const match = content.match(/"reply"\s*:\s*"([^"]*)"/)
  if (!match) return false
  const reply = match[1].trim()
  return reply.length > 0 && !/^[.。…·~～!！?？,，、\s]+$/.test(reply)
}

/**
 * 把 /api/chat 转发给智谱（OpenAI 兼容端点）。
 * Key 只在 Node 侧使用，永远不会出现在浏览器 bundle 里。
 * 没有配 Key 时返回 { ok: false }，前端探测后自动使用本地规则引擎。
 */
function zhipuProxy(apiKey: string, models: string[]): Plugin {
  const primary = models[0]

  const requestOnce = async (
    model: string,
    messages: ChatMessage[],
    temperature: number,
    jsonMode = true,
  ): Promise<{ ok: true; content: string } | { ok: false; status: number; detail: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 14000)
    try {
      const upstream = await fetch(ZHIPU_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature,
          messages,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      })
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '')
        return { ok: false, status: upstream.status, detail }
      }
      const payload = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      return { ok: true, content: payload.choices?.[0]?.message?.content ?? '' }
    } finally {
      clearTimeout(timer)
    }
  }

  const handle: Connect.NextHandleFunction = (req, res) => {
    void (async () => {
      const send = (status: number, payload: unknown) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(payload))
      }

      if (req.method === 'GET') {
        send(200, { ok: Boolean(apiKey), model: primary, fallbacks: models.slice(1), provider: 'zhipu' })
        return
      }

      if (req.method !== 'POST') {
        send(405, { error: 'method not allowed' })
        return
      }

      if (!apiKey) {
        send(503, { error: 'ZHIPU_API_KEY is not configured' })
        return
      }

      try {
        const chunks: string[] = []
        for await (const chunk of req) chunks.push(String(chunk))
        const body = JSON.parse(chunks.join('') || '{}') as {
          text?: string
          current?: string
          affinity?: number
          hint?: { emotion?: string; confidence?: number }
          coax?: boolean
          history?: { role?: string; text?: string }[]
        }
        if (!body.text) {
          send(400, { error: 'text is required' })
          return
        }

        const history = Array.isArray(body.history) ? body.history.slice(-10) : []
        const recall = lastTurns(history)
        const messages: ChatMessage[] = [
          {
            role: 'system',
            content:
              SYSTEM_PROMPT +
              '\n\n' +
              (body.coax
                ? toneSystem(60) + '\n他正在道歉、哄你：你可以消气原谅他，但别立刻贴上去。'
                : toneSystem(body.affinity ?? 50)),
          },
          ...history
            .filter((turn) => turn && typeof turn.text === 'string' && turn.text.length > 0)
            .map<ChatMessage>((turn) => ({
              role: turn.role === 'user' ? 'user' : 'assistant',
              content: String(turn.text).slice(0, 200),
            })),
          {
            role: 'user',
            content: buildUserMessage(
              body.text,
              body.current ?? 'idle',
              body.affinity ?? 50,
              body.hint && body.hint.emotion
                ? { emotion: body.hint.emotion, confidence: Number(body.hint.confidence ?? 0.5) }
                : undefined,
              recall.lastUser,
              recall.lastPet,
              Boolean(body.coax),
            ),
          },
        ]

        let lastError = ''
        for (const candidate of models) {
          let result = await requestOnce(candidate, messages, 0.8)

          /* 个别兼容端点不认 response_format：退回纯提示词模式再试一次 */
          if (!result.ok && result.status === 400 && /response_format/i.test(result.detail)) {
            result = await requestOnce(candidate, messages, 0.8, false)
          }

          /* 输出不合格（空 / 纯省略号 / 没有 JSON）：丢掉历史、保留人设，再来一次 */
          if (result.ok && !looksUsable(result.content)) {
            console.warn(`[zhipu] ${candidate} 输出不合格，重试一次`)
            result = await requestOnce(
              candidate,
              [
                messages[0],
                {
                  role: 'user',
                  content: `${messages[messages.length - 1].content}\n\n${RETRY_PROMPT}`,
                },
              ],
              0.2,
            )
          }

          if (result.ok) {
            console.log(`[zhipu] ${candidate} →`, result.content.replace(/\s+/g, ' ').slice(0, 90))
            send(200, { content: result.content, model: candidate })
            return
          }

          lastError = `zhipu ${result.status}: ${result.detail.slice(0, 200)}`
          console.warn(`[zhipu] ${candidate} failed →`, lastError)

          /* Key 无效 / 限流 / 服务端错误：换模型也没用，直接失败回退本地规则 */
          if (result.status === 401 || result.status === 429 || result.status >= 500) break
          /* 模型不存在才继续试下一个 */
          if (!MODEL_ERROR.test(result.detail)) break
        }

        send(502, { error: lastError || 'upstream failed' })
      } catch (error) {
        send(502, { error: error instanceof Error ? error.message : 'upstream failed' })
      }
    })()
  }

  /* ---------------- SSE 流式：首字就推给前端 ---------------- */
  const handleStream: Connect.NextHandleFunction = (req, res) => {
    void (async () => {
      if (req.method === 'GET') {
        res.statusCode = 200
        res.end('stream-ready')
        return
      }
      if (!apiKey) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'ZHIPU_API_KEY is not configured' }))
        return
      }

      try {
        const chunks: string[] = []
        for await (const chunk of req) chunks.push(String(chunk))
        const body = JSON.parse(chunks.join('') || '{}') as {
          text?: string
          current?: string
          affinity?: number
          hint?: { emotion?: string; confidence?: number }
          coax?: boolean
          history?: { role?: string; text?: string }[]
        }
        if (!body.text) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'text is required' }))
          return
        }

        const history = Array.isArray(body.history) ? body.history.slice(-10) : []
        const recall = lastTurns(history)
        const messages: ChatMessage[] = [
          {
            role: 'system',
            content:
              SYSTEM_PROMPT +
              '\n\n' +
              (body.coax
                ? toneSystem(60) + '\n他正在道歉、哄你：你可以消气原谅他，但别立刻贴上去。'
                : toneSystem(body.affinity ?? 50)),
          },
          ...history
            .filter((turn) => turn && typeof turn.text === 'string' && turn.text.length > 0)
            .map<ChatMessage>((turn) => ({
              role: turn.role === 'user' ? 'user' : 'assistant',
              content: String(turn.text).slice(0, 200),
            })),
          {
            role: 'user',
            content: buildUserMessage(
              body.text,
              body.current ?? 'idle',
              body.affinity ?? 50,
              body.hint && body.hint.emotion
                ? { emotion: body.hint.emotion, confidence: Number(body.hint.confidence ?? 0.5) }
                : undefined,
              recall.lastUser,
              recall.lastPet,
              Boolean(body.coax),
            ),
          },
        ]

        const controller = new AbortController()
        req.on('close', () => controller.abort())

        const upstream = await fetch(ZHIPU_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: primary,
            temperature: 0.8,
            stream: true,
            response_format: { type: 'json_object' },
            messages,
          }),
          signal: controller.signal,
        })

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => '')
          console.warn('[zhipu] stream failed →', upstream.status, detail.slice(0, 160))
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: `zhipu ${upstream.status}`, detail: detail.slice(0, 200) }))
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })

        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          res.write(chunk)
        }
        res.end()
      } catch (error) {
        if (!res.headersSent) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'stream failed' }))
        } else {
          res.end()
        }
      }
    })()
  }

  return {
    name: 'aolinu-zhipu-proxy',
    configureServer(server) {
      /* 更具体的路径要先注册，否则会被 /api/chat 前缀吃掉 */
      server.middlewares.use('/api/chat/stream', handleStream)
      server.middlewares.use('/api/chat', handle)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/chat/stream', handleStream)
      server.middlewares.use('/api/chat', handle)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.ZHIPU_API_KEY ?? ''
  const models = [env.ZHIPU_MODEL || 'glm-4-flash', env.ZHIPU_MODEL_FALLBACK || 'glm-5.3-flash']
    .map((item) => item.trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index)

  if (apiKey) console.log(`\n[aolinu] 智谱已接入 · ${models.join(' → ')}\n`)
  else console.log('\n[aolinu] 未检测到 ZHIPU_API_KEY，使用本地规则引擎（填好 Key 后会自动切换）\n')

  return {
    base: './',
    plugins: [react(), zhipuProxy(apiKey, models)],
    server: { port: 5173, host: '127.0.0.1' },
    build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  }
})
