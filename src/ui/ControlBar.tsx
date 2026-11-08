import { useState } from 'react'
import { QUICK_ACTIONS } from '../lib/engine'
import { quickAction, userSay, useAppState } from '../lib/store'
import type { QuickAction } from '../lib/types'

const ORDER: QuickAction[] = ['pat', 'praise', 'lull']

const GLYPH: Record<QuickAction, string> = {
  pat: '❀',
  praise: '✦',
  lull: '☾',
}

export function ControlBar() {
  const [value, setValue] = useState('')
  const { thinking, emotion } = useAppState()

  const send = (event: React.FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    userSay(value)
    setValue('')
  }

  return (
    <footer className="dock">
      <div className="dock-inner">
        <div className="quick-row">
          {ORDER.map((action) => (
            <button
              key={action}
              type="button"
              className="quick-btn"
              onClick={() => quickAction(action)}
              disabled={thinking}
              data-emotion-target={QUICK_ACTIONS[action].emotion}
            >
              <span className="glyph">{GLYPH[action]}</span>
              {QUICK_ACTIONS[action].label}
            </button>
          ))}
        </div>

        <form className="input-row" onSubmit={send}>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              emotion === 'sleepy' ? '它睡着了，说句话叫醒它…' : '对它说点什么…（试试「你今天真棒」）'
            }
            aria-label="对角色说话"
            maxLength={80}
          />
          <button type="submit" className="send-btn" disabled={!value.trim() || thinking} aria-label="发送">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M2.5 8h10M8.5 3.5 13 8l-4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>

        <div className="hint">1–5 强制状态 · D 调试台 · L 清空日志</div>
      </div>
    </footer>
  )
}
