import { Fragment, useState } from 'react'
import { AFFINITY_LABEL, affinityBand } from '../lib/engine'
import { formatDuration, formatTime, useElapsed } from '../lib/hooks'
import { EMOTION_META, EMOTION_ORDER, LIGHT_PRESETS } from '../lib/palette'
import {
  adjustAffinity,
  clearLogs,
  forceEmotion,
  resetAffinity,
  sendSystemBubble,
  setDebugOpen,
  setLightColor,
  useAppState,
} from '../lib/store'
import type { LogType } from '../lib/types'

const TAG: Record<LogType, string> = {
  user: 'USER',
  pet: 'PET',
  system: 'SYS',
  debug: 'DBG',
  state: 'STATE',
}

export function DebugPanel() {
  const state = useAppState()
  const [sysText, setSysText] = useState('')
  const elapsed = useElapsed(state.since)
  const meta = EMOTION_META[state.emotion]
  const recentMoves = state.moves.slice(-3)
  const logs = [...state.logs].reverse()

  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      emotion: state.emotion,
      confidence: state.confidence,
      affinity: state.affinity,
      affinityBand: affinityBand(state.affinity),
      engine: state.engine,
      reason: state.reason,
      since: new Date(state.since).toISOString(),
      moves: state.moves,
      logs: state.logs,
      turns: state.turns,
      lightColor: state.lightColor,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `aolinu-state-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const submitSystem = (event: React.FormEvent) => {
    event.preventDefault()
    if (!sysText.trim()) return
    sendSystemBubble(sysText)
    setSysText('')
  }

  return (
    <aside className="debug" data-open={state.debugOpen} aria-hidden={!state.debugOpen}>
      <div className="debug-head">
        <div>
          <h2>State Inspector</h2>
          <p>状态监控与远程调试台 · {state.engine}</p>
        </div>
        <button type="button" className="debug-close" onClick={() => setDebugOpen(false)} aria-label="关闭调试台">
          ✕
        </button>
      </div>

      <div className="debug-scroll">
        <section>
          <div className="section-label">
            <span>当前状态</span>
            <span>{meta.en}</span>
          </div>
          <div className="state-card">
            <div className="state-code">{meta.code}</div>
            <div className="state-cn">
              {meta.cn} · {meta.hint}
            </div>

            <div className="metric-grid">
              <div className="metric">
                <dt>置信度</dt>
                <dd>{(state.confidence * 100).toFixed(0)}%</dd>
              </div>
              <div className="metric">
                <dt>持续</dt>
                <dd>{formatDuration(elapsed)}</dd>
              </div>
              <div className="metric">
                <dt>FPS</dt>
                <dd>{state.fps}</dd>
              </div>
            </div>

            <div className="meter">
              <div className="meter-top">
                <span>confidence</span>
                <span>{state.confidence.toFixed(2)}</span>
              </div>
              <div className="meter-track">
                <div className="meter-fill" style={{ width: `${Math.round(state.confidence * 100)}%` }} />
              </div>
            </div>

            <div className="meter">
              <div className="meter-top">
                <span>affinity · {AFFINITY_LABEL[affinityBand(state.affinity)]}</span>
                <span>
                  {state.affinity}
                  {state.affinityTrend > 0 ? ' ↑' : state.affinityTrend < 0 ? ' ↓' : ''}
                </span>
              </div>
              <div className="meter-track">
                <div className="meter-fill affinity" style={{ width: `${state.affinity}%` }} />
              </div>
            </div>

            <div className="affinity-actions">
              {[10, 1, -1, -10].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  className="ghost-btn"
                  onClick={() => adjustAffinity(delta)}
                >
                  {delta > 0 ? `+${delta}` : `${delta}`}
                </button>
              ))}
              <button type="button" className="ghost-btn" onClick={resetAffinity}>
                重置
              </button>
            </div>
            <div className="move-reason" style={{ marginTop: 6 }}>
              手动调节 / 自然冷却：静置 14 小时 −1
            </div>
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>状态迁移</span>
            <span>{state.moves.length} moves</span>
          </div>
          <div className="move-row">
            {recentMoves.length === 0 ? (
              <span className="move-reason">等待第一次迁移…</span>
            ) : (
              recentMoves.map((move, index) => (
                <Fragment key={move.id}>
                  {index === 0 && (
                    <span className="move-chip">{EMOTION_META[move.from].code.replace('EMO_', '')}</span>
                  )}
                  <span className="move-arrow">→</span>
                  <span className="move-chip current">
                    {EMOTION_META[move.to].code.replace('EMO_', '')}
                  </span>
                </Fragment>
              ))
            )}
          </div>
          <div className="move-reason" style={{ marginTop: 6 }}>
            last: {state.reason} · {state.confidence.toFixed(2)}
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>对话</span>
            <span>{state.turns.length} turns</span>
          </div>
          <div className="chat-list">
            {state.turns.length === 0 ? (
              <div className="empty">还没有对话 · 对它说句话</div>
            ) : (
              state.turns.slice(-6).map((turn) => (
                <div className="chat-line" data-role={turn.role} key={turn.id}>
                  <span className="chat-role">{turn.role === 'user' ? '你' : '晓'}</span>
                  <span className="chat-text">{turn.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>事件日志</span>
            <span>{state.logs.length}</span>
          </div>
          <div className="log-list">
            {logs.length === 0 ? (
              <div className="empty">暂无事件 · 试试快捷互动</div>
            ) : (
              logs.map((entry) => (
                <div className="log-item" data-type={entry.type} key={entry.id}>
                  <span className="log-time">{formatTime(entry.ts)}</span>
                  <span className="log-tag">{TAG[entry.type]}</span>
                  <span className="log-text">{entry.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>手动调试</span>
            <span>force state</span>
          </div>
          <div className="force-grid">
            {EMOTION_ORDER.map((emotion) => (
              <button
                key={emotion}
                type="button"
                className="force-btn"
                data-active={state.emotion === emotion}
                onClick={() => forceEmotion(emotion)}
              >
                {EMOTION_META[emotion].cn}
                <code>{EMOTION_META[emotion].code.replace('EMO_', '')}</code>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>场景灯光</span>
            <span>{state.lightColor ? state.lightColor.toUpperCase() : 'auto'}</span>
          </div>
          <div className="swatches">
            {LIGHT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`swatch${preset.color ? '' : ' auto'}`}
                data-active={
                  preset.color === null ? state.lightColor === null : state.lightColor === preset.color
                }
                style={preset.color ? { background: preset.color } : undefined}
                onClick={() => setLightColor(preset.color)}
                title={preset.label}
                aria-label={preset.label}
              >
                {preset.color ? '' : 'A'}
              </button>
            ))}
            <input
              type="color"
              className="swatch color-input"
              value={state.lightColor ?? '#4f7bff'}
              onChange={(event) => setLightColor(event.target.value)}
              aria-label="自定义灯光颜色"
              title="自定义"
            />
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>系统气泡</span>
            <span>to stage</span>
          </div>
          <form className="sys-row" onSubmit={submitSystem}>
            <input
              value={sysText}
              onChange={(event) => setSysText(event.target.value)}
              placeholder="向主画面发送一条提示…"
              maxLength={60}
            />
            <button type="submit">发送</button>
          </form>
        </section>
      </div>

      <div className="debug-foot">
        <button type="button" className="ghost-btn" onClick={clearLogs}>
          清空日志
        </button>
        <button type="button" className="ghost-btn" onClick={exportJson}>
          导出 JSON
        </button>
      </div>
    </aside>
  )
}
