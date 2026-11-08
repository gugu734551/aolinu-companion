import { toggleDebug, useAppState } from '../lib/store'

export function TopBar() {
  const { fps, debugOpen } = useAppState()

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden />
        <div className="brand-text">
          <span className="brand-name">Aolinu</span>
          <span className="brand-sub">万物奥临 · 伴侣小生命 · 初代「晓」</span>
        </div>
      </div>

      <div className="topbar-right">
        <span className="status-pill hide-sm">
          <span className="status-dot" />
          在线
          <span className="mono">{fps} FPS</span>
        </span>
        <button
          type="button"
          className="icon-btn"
          data-active={debugOpen}
          onClick={toggleDebug}
          aria-pressed={debugOpen}
        >
          调试台
          <kbd>D</kbd>
        </button>
      </div>
    </header>
  )
}
