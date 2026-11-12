import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { LiveSnapshot } from '../shared/types'
import { budgetClass, fmtMoney, fmtPct } from './format'
import './styles.css'

function Overlay(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => window.api.onPush((snap) => setSnapshot(snap)), [])

  // 内容高度回报给主进程，让窗口跟着行数长
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(node.getBoundingClientRect().height)
      if (height > 0) void window.api.overlaySetHeight(height + 8)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const models = (snapshot?.models ?? []).filter((m) => m.watch)

  const onMouseDown = (event: React.MouseEvent): void => {
    if (event.button !== 0) return
    setDragging(true)
    void window.api.overlayDragStart()
  }

  const stop = (): void => {
    if (!dragging) return
    setDragging(false)
    void window.api.overlayDragEnd()
  }

  useEffect(() => {
    if (!dragging) return
    const up = (): void => {
      setDragging(false)
      void window.api.overlayDragEnd()
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [dragging])

  const totals = snapshot?.totals
  const budgetRatio = totals?.budgetRatio ?? null

  return (
    <div
      ref={rootRef}
      className="panel"
      onMouseDown={onMouseDown}
      onMouseUp={stop}
      onDoubleClick={() => void window.api.overlayOpenMain()}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.api.overlayMenu()
      }}
      onMouseEnter={() => void window.api.overlayHover(true)}
      onMouseLeave={() => void window.api.overlayHover(false)}
    >
      <div className="panel-head">
        <b>LLM Meter</b>
        <span className="live">
          {snapshot?.proxyRunning ? (
            <span className="mono">{totals?.tps.toFixed(1)} t/s</span>
          ) : (
            <span style={{ color: 'var(--bad)' }}>代理未启动</span>
          )}
        </span>
      </div>

      {!snapshot?.proxyRunning ? <div className="graybar">{snapshot?.proxyError ?? '代理未运行'}</div> : null}

      <div className="rows">
        {models.length === 0 ? <div className="oempty">还没有流量</div> : null}
        {models.map((m) => {
          const budget = budgetClass(m.budgetRatio)
          const max = Math.max(1, ...m.buckets)
          return (
            <div className="orow" key={m.modelId} title={m.lastError ?? undefined}>
              <span className="onalias">
                {m.alias}
                {m.today.errors > 0 ? <span style={{ color: 'var(--bad)' }}> !</span> : null}
              </span>
              <span className="obar">
                {m.buckets.slice(-24).map((value, index) => (
                  <i
                    key={index}
                    className={index >= 14 && value > 0 ? 'hot' : undefined}
                    style={{ height: `${value > 0 ? Math.max(2, Math.round((value / max) * 14)) : 1}px` }}
                  />
                ))}
              </span>
              <span className="mono">{fmtPct(m.hitRate)}</span>
              <span className={`mono ${budget ? `pill ${budget}` : ''}`} style={{ textAlign: 'right' }}>
                {fmtMoney(m.today.cost, m.currency)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="ofoot">
        <span>
          命中 <b>{fmtPct(totals?.hitRate ?? null)}</b>
        </span>
        <span>
          今日 <b>{fmtMoney(totals?.todayCost ?? 0, totals?.currency ?? 'USD')}</b>
          {budgetRatio !== null ? ` / ${fmtPct(budgetRatio)} 预算` : ''}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {totals?.errors ? <span style={{ color: 'var(--bad)' }}>{totals.errors} 错</span> : null}
        </span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Overlay />)
