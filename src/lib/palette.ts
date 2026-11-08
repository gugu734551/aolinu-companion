import type { Emotion } from './types'

export interface EmotionPalette {
  /** deep background, bottom */
  bg1: string
  /** mid background, top haze */
  bg2: string
  /** main light glow */
  glow: string
  /** text / highlight accent */
  accent: string
  /** key light colour in three.js */
  key: string
  /** rim light colour in three.js */
  rim: string
  /** particle colour */
  particle: string
}

export const PALETTE: Record<Emotion, EmotionPalette> = {
  idle: {
    bg1: '#05080f',
    bg2: '#0b1428',
    glow: '#4f7bff',
    accent: '#9cc0ff',
    key: '#7ea6ff',
    rim: '#2f5bd6',
    particle: '#8fb4ff',
  },
  happy: {
    bg1: '#140a05',
    bg2: '#2a1204',
    glow: '#ff9a3d',
    accent: '#ffc978',
    key: '#ffb25b',
    rim: '#ff6f2a',
    particle: '#ffd08a',
  },
  sad: {
    bg1: '#04070d',
    bg2: '#0c1522',
    glow: '#6f8bab',
    accent: '#a8c0d8',
    key: '#7f9dc0',
    rim: '#33465e',
    particle: '#8fa8c4',
  },
  angry: {
    bg1: '#120404',
    bg2: '#2a0907',
    glow: '#ff5a4d',
    accent: '#ff9a86',
    key: '#ff6b5a',
    rim: '#a8281d',
    particle: '#ff8f7d',
  },
  sleepy: {
    bg1: '#04060c',
    bg2: '#070d1a',
    glow: '#3d5a99',
    accent: '#7e93c9',
    key: '#5e7bc4',
    rim: '#243560',
    particle: '#6e86c4',
  },
}

export interface EmotionMeta {
  code: string
  cn: string
  en: string
  hint: string
}

export const EMOTION_META: Record<Emotion, EmotionMeta> = {
  idle: { code: 'EMO_IDLE', cn: '待机呼吸', en: 'IDLE', hint: '平稳、安静、持续呼吸' },
  happy: { code: 'EMO_HAPPY', cn: '开心雀跃', en: 'HAPPY', hint: '高能量、暖光、动作幅度大' },
  sad: { code: 'EMO_SAD', cn: '难过低落', en: 'SAD', hint: '低头、收拢、冷灰蓝氛围' },
  angry: { code: 'EMO_ANGRY', cn: '生气炸毛', en: 'ANGRY', hint: '前倾、挥拳、暗红高对比' },
  sleepy: { code: 'EMO_SLEEPY', cn: '犯困打盹', en: 'SLEEPY', hint: '低能量、慢呼吸、冷调压暗' },
}

export const EMOTION_ORDER: Emotion[] = ['idle', 'happy', 'sad', 'angry', 'sleepy']

export interface LightPreset {
  id: string
  label: string
  color: string | null
}

export const LIGHT_PRESETS: LightPreset[] = [
  { id: 'auto', label: '跟随情绪', color: null },
  { id: 'warm', label: '暖阳', color: '#ffb25b' },
  { id: 'cyan', label: '冷青', color: '#5fe3ff' },
  { id: 'violet', label: '霓紫', color: '#b98bff' },
  { id: 'rose', label: '玫瑰', color: '#ff7ba8' },
]

/** animation clips shipped inside RobotExpressive.glb */
export const CLIP_BY_EMOTION: Record<Emotion, string> = {
  idle: 'Idle',
  happy: 'Dance',
  sad: 'No',
  angry: 'Punch',
  sleepy: 'Sitting',
}

export const TIME_SCALE_BY_EMOTION: Record<Emotion, number> = {
  idle: 1,
  happy: 1,
  sad: 0.7,
  angry: 0.95,
  sleepy: 0.45,
}

/**
 * 这些情绪的动画只播一次、停在末帧。
 * 犯困用的 `Sitting` 只有 0.42s，是一段「坐下」的过渡；
 * 循环播放就会变成「坐下—起立—坐下」的抽搐。
 */
export const HOLD_CLIP_BY_EMOTION: Partial<Record<Emotion, boolean>> = {
  sleepy: true,
}

/** 从这些情绪离开时，先播一段起身过渡，避免从坐姿直接弹回站姿 */
export const EXIT_CLIP_BY_EMOTION: Partial<Record<Emotion, string>> = {
  sleepy: 'Standing',
}

export interface PoseTarget {
  tilt: number
  yaw: number
  lift: number
  scale: number
  breath: number
}

/** whole-body pose layered on top of the skeletal animation */
export const POSE_BY_EMOTION: Record<Emotion, PoseTarget> = {
  idle: { tilt: 0, yaw: 0, lift: 0, scale: 1, breath: 2.1 },
  happy: { tilt: -0.05, yaw: 0, lift: 0.02, scale: 1.02, breath: 3.6 },
  sad: { tilt: 0.19, yaw: -0.1, lift: -0.09, scale: 0.93, breath: 1.1 },
  angry: { tilt: -0.04, yaw: 0, lift: 0.01, scale: 1.03, breath: 3.8 },
  sleepy: { tilt: 0.09, yaw: -0.12, lift: -0.05, scale: 0.985, breath: 0.9 },
}
