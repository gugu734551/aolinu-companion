import { useEffect, useState } from 'react'

/** re-renders every `interval` ms so durations tick without a global clock */
export function useElapsed(since: number, interval = 500): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(id)
  }, [interval])

  return Math.max(0, now - since)
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatTime(ts: number): string {
  const date = new Date(ts)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

/** mix a hex colour toward white by `amount` (0..1) */
export function lighten(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount)
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
