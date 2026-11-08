import { useEffect } from 'react'
import { lighten } from './lib/hooks'
import { initEngine } from './lib/llm'
import { EMOTION_META, EMOTION_ORDER, PALETTE } from './lib/palette'
import { clearLogs, forceEmotion, setDebugOpen, setEngine, toggleDebug, useAppState } from './lib/store'
import { Stage } from './three/Stage'
import { Bubble } from './ui/Bubble'
import { ControlBar } from './ui/ControlBar'
import { DebugPanel } from './ui/DebugPanel'
import { TopBar } from './ui/TopBar'

export default function App() {
  const state = useAppState()

  /* palette -> css custom properties (interpolated through @property) */
  useEffect(() => {
    const palette = PALETTE[state.emotion]
    const root = document.documentElement
    const glow = state.lightColor ?? palette.glow
    root.style.setProperty('--glow', glow)
    root.style.setProperty('--accent', state.lightColor ? lighten(state.lightColor, 0.42) : palette.accent)
    root.style.setProperty('--bg1', palette.bg1)
    root.style.setProperty('--bg2', palette.bg2)
  }, [state.emotion, state.lightColor])

  /* 探测语义层：有智谱 Key 就切到 GLM，没有就继续用本地规则 */
  useEffect(() => {
    let alive = true
    void initEngine().then((engineInfo) => {
      if (alive) setEngine(engineInfo.label)
    })
    return () => {
      alive = false
    }
  }, [])

  /* keyboard shortcuts */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const index = Number(event.key) - 1
      if (index >= 0 && index < EMOTION_ORDER.length) {
        event.preventDefault()
        forceEmotion(EMOTION_ORDER[index])
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'd') {
        event.preventDefault()
        toggleDebug()
      } else if (key === 'l') {
        event.preventDefault()
        clearLogs()
      } else if (event.key === 'Escape') {
        setDebugOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app" data-debug={state.debugOpen}>
      <div className="ambient" aria-hidden />
      <div className="grain" aria-hidden />
      <div className="vignette" aria-hidden />

      <TopBar />

      <main className="stage">
        <Stage />
        <div className="stage-glow" aria-hidden />
        <Bubble />
        <div className="nameplate" aria-hidden={false}>
          <span className="dot" />
          <b>晓</b>
          <span>XIAO · 初代伴侣机器人</span>
          <span>·</span>
          <span>{EMOTION_META[state.emotion].cn}</span>
        </div>
      </main>

      <ControlBar />
      <DebugPanel />

      <div className="loading" data-done={state.ready} aria-live="polite">
        <div className="loading-inner">
          <div className="ring" aria-hidden />
          正在唤醒 · 晓
        </div>
      </div>
    </div>
  )
}
