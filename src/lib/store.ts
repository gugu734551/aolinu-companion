import { useSyncExternalStore } from 'react'
import type {
  Bubble,
  Emotion,
  LogEntry,
  LogType,
  Move,
  QuickAction,
  Reaction,
  TransitionReason,
  Turn,
} from './types'
import { AFFINITY_LABEL, affinityBand, classify, QUICK_ACTIONS } from './engine'
import { getEngine, getEngineInfo } from './llm'
import { EMOTION_META } from './palette'

export interface AppState {
  emotion: Emotion
  confidence: number
  reason: TransitionReason
  since: number
  moves: Move[]
  logs: LogEntry[]
  bubble: Bubble | null
  thinking: boolean
  debugOpen: boolean
  lightColor: string | null
  fps: number
  ready: boolean
  reaction: Reaction | null
  lastInput: string
  /** 0–100：情绪记忆，决定语气亲疏与光影浓度 */
  affinity: number
  /** 最近一次好感度变化量，用于面板上的 ↑↓ 提示 */
  affinityTrend: number
  engine: string
  /** 最近几轮对话（多轮上下文 + 调试台「对话」面板） */
  turns: Turn[]
}

const DECAY_MS = 9000
const BUBBLE_MS = 6500
const MAX_LOGS = 160
const DECAY_AFTER_MS = 14 * 60 * 60 * 1000
const DECAY_CHECK_MS = 60_000
const REPEAT_MS = 20_000

let seq = 0
const nextId = () => ++seq

let state: AppState = {
  emotion: 'idle',
  confidence: 0.72,
  reason: 'boot',
  since: Date.now(),
  moves: [],
  logs: [],
  bubble: null,
  thinking: false,
  debugOpen: false,
  lightColor: null,
  fps: 60,
  ready: false,
  reaction: null,
  lastInput: '',
  affinity: 50,
  affinityTrend: 0,
  engine: getEngineInfo().label,
  turns: [],
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getState(): AppState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, getState)
}

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch }
  emit()
}

function log(type: LogType, text: string, extra?: { emotion?: Emotion; confidence?: number }) {
  const entry: LogEntry = {
    id: nextId(),
    ts: Date.now(),
    type,
    text,
    emotion: extra?.emotion,
    confidence: extra?.confidence,
  }
  const logs = [...state.logs, entry]
  setState({ logs: logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs })
}

/* ------------------------------------------------------------------ */
/* timers                                                              */
/* ------------------------------------------------------------------ */

let decayTimer: number | undefined
let bubbleTimer: number | undefined
let thinkTimer: number | undefined

/** 最后一次真实互动的时间，用于关系冷却 */
let lastTouch = Date.now()

/** 上一次快捷互动，用于「连着点收益递减」 */
let lastAction: { type: QuickAction; at: number } | null = null

/** 上次自然冷却的时间，保证「14 小时」的节流 */
let lastDecayAt = 0

/** 好感度 ↑↓ 提示 6 秒后归零 */
let trendTimer: number | undefined

function scheduleDecay(emotion: Emotion) {
  window.clearTimeout(decayTimer)
  if (emotion !== 'happy' && emotion !== 'sad' && emotion !== 'angry') return
  decayTimer = window.setTimeout(() => {
    if (state.emotion === emotion) {
      log('debug', '状态自然回落 · 情绪衰减')
      transition('idle', 'decay', 0.5)
    }
  }, DECAY_MS)
}

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

export function transition(to: Emotion, reason: TransitionReason, confidence: number) {
  if (to === state.emotion) {
    setState({ confidence, reason, since: Date.now() })
    scheduleDecay(to)
    return
  }
  const from = state.emotion
  const move: Move = { id: nextId(), from, to, reason, ts: Date.now(), confidence }
  setState({
    emotion: to,
    confidence,
    reason,
    since: Date.now(),
    moves: [...state.moves.slice(-29), move],
  })
  log('state', `${EMOTION_META[from].code} → ${EMOTION_META[to].code} · ${reason}`, {
    emotion: to,
    confidence,
  })
  scheduleDecay(to)
}

function scheduleBubbleClear(id: number) {
  window.clearTimeout(bubbleTimer)
  bubbleTimer = window.setTimeout(() => {
    if (state.bubble?.id === id) setState({ bubble: null })
  }, BUBBLE_MS)
}

function showBubble(kind: Bubble['kind'], text: string, emotion: Emotion) {
  const bubble: Bubble = { id: nextId(), kind, text, emotion }
  setState({ bubble })
  scheduleBubbleClear(bubble.id)
}

interface ReplyJob {
  /** 发给模型的内容：打字是原话，快捷互动是动作描述 */
  text: string
  /** 气泡上方「你说：」显示的内容 */
  chip: string
  /** 日志里的 USER 行 */
  logText: string
  hintEmotion: Emotion
  hintConfidence: number
  matched: string[]
  /** 一次性反应动画（快捷互动用） */
  reaction?: { clip: string; emotion: Emotion }
  affinityDelta: number
  affinityReason: string
}

function runReply(job: ReplyJob) {
  const history = state.turns.slice(-10)
  const bubbleId = nextId()

  log('user', job.logText)
  if (job.reaction) setState({ reaction: { id: nextId(), ...job.reaction } })

  setState({
    thinking: true,
    lastInput: job.chip,
    bubble: null,
    turns: [...state.turns, { id: nextId(), role: 'user' as const, text: job.text, ts: Date.now() }].slice(-20),
  })

  window.clearTimeout(thinkTimer)
  thinkTimer = window.setTimeout(async () => {
    const asleep = state.emotion === 'sleepy'
    const base = asleep ? 'idle' : state.emotion
    const engine = getEngine()
    const input = {
      text: job.text,
      current: base,
      affinity: state.affinity,
      history,
      hint: { emotion: job.hintEmotion, confidence: job.hintConfidence },
    }

    /* 流式：模型吐一个字就更新一次气泡，首字 0.5~1s 就能看到 */
    const onDelta = (partial: string) => {
      setState({
        thinking: false,
        bubble: { id: bubbleId, kind: 'pet', text: partial, emotion: base, streaming: true },
      })
      scheduleBubbleClear(bubbleId)
    }

    let intent
    try {
      /* 关系疏离时不流式：冷回应最后会被压成短句，流式反而会闪一下 */
      if (state.affinity >= 20 && engine.stream) {
        intent = await engine.stream(input, onDelta)
      } else {
        intent = await engine.classify(input)
        onDelta(intent.reply)
      }
    } catch {
      intent = await engine.classify(input)
      onDelta(intent.reply)
    }

    const engineInfo = getEngineInfo()
    setState({
      thinking: false,
      turns: [
        ...state.turns,
        { id: nextId(), role: 'pet' as const, text: intent.reply, ts: Date.now() },
      ].slice(-20),
      bubble: { id: bubbleId, kind: 'pet', text: intent.reply, emotion: intent.emotion, streaming: true },
    })
    scheduleBubbleClear(bubbleId)
    log('pet', intent.reply, { emotion: intent.emotion, confidence: intent.confidence })

    if (engineInfo.mode === 'llm') {
      log('debug', `${engineInfo.label} 回应 · conf ${intent.confidence.toFixed(2)}`)
    } else if (job.matched.length) {
      log('debug', `local-rules 命中「${job.matched.join('、')}」 · conf ${intent.confidence.toFixed(2)}`)
    } else {
      log('debug', `local-rules 未命中 · 保持 ${EMOTION_META[base].code}`)
    }

    if (intent.emotion !== state.emotion) {
      transition(intent.emotion, asleep ? 'wake' : job.reaction ? 'quick_action' : 'user_text', intent.confidence)
    } else {
      /* 情绪没变也要刷新置信度，否则调试台一直显示旧的 */
      setState({ confidence: intent.confidence })
    }

    /* 被凶 / 被冷落会掉好感；道歉和哄它不算，反而要加分 */
    const coaxed = job.matched.includes('哄')
    if (!coaxed && intent.emotion === 'angry') bumpAffinity(-7, '被凶了')
    else if (!coaxed && intent.emotion === 'sad') bumpAffinity(-5, '被冷落')
    else bumpAffinity(job.affinityDelta, job.affinityReason)
    /* 流式时不需要人为拖延：让「···」先渲染一帧就直接请求 */
  }, 120)
}

export function userSay(raw: string) {
  const text = raw.trim()
  if (!text) return

  const hint = classify(text, state.emotion === 'sleepy' ? 'idle' : state.emotion, state.affinity)
  const coaxed = hint.matched.includes('哄')
  runReply({
    text,
    chip: text,
    logText: text,
    hintEmotion: hint.emotion,
    hintConfidence: hint.confidence,
    matched: hint.matched,
    affinityDelta: coaxed ? 9 : hint.confidence > 0.5 ? 4 : 1,
    affinityReason: coaxed ? '被哄好了' : '被回应',
  })
}

/**
 * 好感度：0–100。
 * - 被夸 / 被摸头会涨，被凶 / 被冷落会掉；
 * - 同一个动作反复做，收益递减；
 * - 长时间没人搭理会缓慢冷却（每 30s −1，最低 20）。
 */
export function bumpAffinity(delta: number, reason: string, touch = true) {
  const next = Math.min(100, Math.max(0, state.affinity + delta))
  if (next === state.affinity) return
  const before = affinityBand(state.affinity)
  const after = affinityBand(next)
  setState({ affinity: next, affinityTrend: next - state.affinity })
  window.clearTimeout(trendTimer)
  trendTimer = window.setTimeout(() => setState({ affinityTrend: 0 }), 6000)
  if (touch) lastTouch = Date.now()
  if (reason) log('debug', `好感度 ${delta > 0 ? '+' : ''}${delta} → ${next}（${reason}）`)
  if (before !== after) {
    log('system', `关系变化：${AFFINITY_LABEL[before]} → ${AFFINITY_LABEL[after]}`)
  }
}

/* 14 小时没人理会，关系才掉 1 点；之后每再满 14 小时掉 1 点 */
window.setInterval(() => {
  const now = Date.now()
  if (now - lastTouch < DECAY_AFTER_MS) return
  if (now - lastDecayAt < DECAY_AFTER_MS) return
  if (state.affinity <= 20) return
  lastDecayAt = now
  bumpAffinity(-1, '', false)
  log('debug', '14 小时没有互动 · 好感度 −1')
}, DECAY_CHECK_MS)

export function adjustAffinity(delta: number) {
  bumpAffinity(delta, '手动调试')
}

export function resetAffinity() {
  const before = affinityBand(state.affinity)
  setState({ affinity: 50, affinityTrend: 0 })
  log('debug', `手动重置好感度 → 50（${AFFINITY_LABEL[affinityBand(50)]}）`)
  if (before !== affinityBand(50)) {
    log('system', `关系变化：${AFFINITY_LABEL[before]} → ${AFFINITY_LABEL[affinityBand(50)]}`)
  }
  lastTouch = Date.now()
}

export function quickAction(action: QuickAction) {
  const cfg = QUICK_ACTIONS[action]
  const now = Date.now()

  /* 同一个按钮连着点，收益递减（摸烦了） */
  let delta = action === 'praise' ? 9 : action === 'pat' ? 7 : 3
  if (lastAction && lastAction.type === action && now - lastAction.at < REPEAT_MS) {
    delta = Math.max(1, Math.round(delta * 0.35))
  }
  lastAction = { type: action, at: now }

  runReply({
    text: cfg.text,
    chip: cfg.label,
    logText: `[快捷互动] ${cfg.label}`,
    hintEmotion: cfg.emotion,
    hintConfidence: 0.95,
    matched: ['快捷互动'],
    reaction: { clip: cfg.clip, emotion: cfg.emotion },
    affinityDelta: delta,
    affinityReason: cfg.label,
  })
}

export function forceEmotion(emotion: Emotion) {
  log('debug', `手动强制切换 → ${EMOTION_META[emotion].code}`)
  setState({ reaction: null })
  transition(emotion, 'debug_force', 0.99)
}

export function setLightColor(color: string | null) {
  setState({ lightColor: color })
  log('debug', color ? `灯光主题色 → ${color.toUpperCase()}` : '灯光主题色 → 跟随情绪')
}

export function sendSystemBubble(text: string) {
  const value = text.trim()
  if (!value) return
  showBubble('system', value, state.emotion)
  log('system', `系统气泡：${value}`)
}

export function toggleDebug() {
  setState({ debugOpen: !state.debugOpen })
}

export function setDebugOpen(open: boolean) {
  if (state.debugOpen !== open) setState({ debugOpen: open })
}

export function clearLogs() {
  setState({ logs: [] })
}

export function setFps(fps: number) {
  const value = Math.round(fps)
  if (value !== state.fps) setState({ fps: value })
}

export function setReady(ready: boolean) {
  if (state.ready !== ready) setState({ ready })
}

/** 启动探测完成后更新调试台标题里的引擎标识 */
export function setEngine(label: string) {
  if (state.engine !== label) setState({ engine: label })
}
