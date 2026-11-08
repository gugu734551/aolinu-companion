export type Emotion = 'idle' | 'happy' | 'sad' | 'angry' | 'sleepy'

export type TransitionReason =
  | 'boot'
  | 'user_text'
  | 'quick_action'
  | 'debug_force'
  | 'decay'
  | 'wake'
  | 'theme'

export type LogType = 'user' | 'pet' | 'system' | 'debug' | 'state'

export interface LogEntry {
  id: number
  ts: number
  type: LogType
  text: string
  emotion?: Emotion
  confidence?: number
}

export interface Move {
  id: number
  from: Emotion
  to: Emotion
  reason: TransitionReason
  ts: number
  confidence: number
}

export interface Bubble {
  id: number
  kind: 'pet' | 'system'
  text: string
  emotion: Emotion
  /** 文本是流式生成出来的，UI 不要再跑打字机 */
  streaming?: boolean
}

export interface Reaction {
  id: number
  clip: string
  emotion: Emotion
}

export type QuickAction = 'pat' | 'praise' | 'lull'

/** 一轮对话，作为多轮上下文的输入 */
export interface Turn {
  id: number
  role: 'user' | 'pet'
  text: string
  ts: number
}
