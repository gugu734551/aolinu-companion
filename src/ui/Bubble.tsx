import { useEffect, useState } from 'react'
import { useAppState } from '../lib/store'

function preview(text: string, max = 26): string {
  const value = text.trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 逐字显示：非流式回退时用，让回复像说出来的 */
function useTypewriter(text: string, id: number | undefined, speed = 34): string {
  const [shown, setShown] = useState(text)

  useEffect(() => {
    if (!text) {
      setShown('')
      return
    }
    let index = 0
    setShown('')
    const timer = window.setInterval(() => {
      index += 1
      setShown(text.slice(0, index))
      if (index >= text.length) window.clearInterval(timer)
    }, speed)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, text, speed])

  return shown
}

export function Bubble() {
  const { bubble, thinking, lastInput } = useAppState()
  const streaming = bubble?.streaming === true

  /* 流式时文本已经是「一个字一个字长出来」的，不要再套一层打字机 */
  const typed = useTypewriter(
    bubble && bubble.kind === 'pet' && !streaming ? bubble.text : '',
    bubble?.id,
  )

  const visible = bubble ? (bubble.kind === 'pet' && !streaming ? typed : bubble.text) : ''
  const waiting = thinking && (!bubble || bubble.text.length === 0)

  if (!bubble && !thinking) return null

  return (
    <div className="bubble-wrap" aria-live="polite">
      {bubble?.kind === 'pet' && lastInput ? (
        <div className="bubble-you" key={`you-${bubble.id}`}>
          你说：{preview(lastInput)}
        </div>
      ) : null}

      {waiting ? (
        <div className="bubble thinking" key="thinking">
          ···
        </div>
      ) : bubble ? (
        <div className="bubble" data-kind={bubble.kind} key={bubble.id}>
          {visible}
          {streaming || (bubble.kind === 'pet' && typed.length < bubble.text.length) ? (
            <span className="caret" aria-hidden />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
