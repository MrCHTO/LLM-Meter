import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { LiveSnapshot } from '../shared/types'
import { fmtMoney } from './format'
import './styles.css'

/** 单模型胶囊：供应商 · 模型 | tok/s | 今日费用 */
function Capsule(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => window.api.onPush(setSnapshot), [])

  // 内容变了就回报尺寸，窗口跟着内容走
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const report = (): void => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) void window.api.overlaySetSize(rect.width + 8, rect.height + 8)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const model = snapshot?.overlayModelId
    ? snapshot.models.find((m) => m.modelId === snapshot.overlayModelId)
    : undefined

  const onMouseDown = (event: React.MouseEvent): void => {
    if (event.button !== 0) return
    setDragging(true)
    void window.api.overlayDragStart()
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

  const theme = snapshot?.overlay.theme ?? 'dark'
  const locked = snapshot?.overlay.locked === true
  // 三个内容片段各自可关；旧配置缺字段时按显示处理
  const showProvider = snapshot?.overlay.showProvider !== false
  const showModel = snapshot?.overlay.showModel !== false
  const showCost = snapshot?.overlay.showCost !== false
  const busy = model?.active === true || model?.probing === true
  // 请求进行中且有增量后显示估算速率；首字前不占位。结束后 5 分钟内灰显真实均值
  const realtime =
    model !== undefined && (model.inflight > 0 || model.probing) && model.realtimeTps !== null
  const lastWithin =
    model?.lastTps !== null &&
    model?.lastTps !== undefined &&
    model.lastTpsAt !== null &&
    model.lastTpsAt !== undefined &&
    Date.now() - model.lastTpsAt < 5 * 60_000

  return (
    <div
      ref={rootRef}
      className={['capsule', `theme-${theme}`, busy && 'inflight', locked && 'locked'].filter(Boolean).join(' ')}
      title={locked ? '已锁定位置' : undefined}
      onMouseDown={onMouseDown}
      onDoubleClick={() => void window.api.overlayOpenMain()}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.api.overlayMenu()
      }}
      onMouseEnter={() => void window.api.overlayHover(true)}
      onMouseLeave={() => void window.api.overlayHover(false)}
    >
      <span className={`capsule-dot ${snapshot?.proxyRunning ? 'on' : 'off'}`} />

      {model ? (
        <>
          {showProvider || showModel ? (
            <span className="capsule-name">
              {showProvider ? <span className="capsule-source">{model.providerName}</span> : null}
              {showProvider && showModel ? <span className="capsule-sep">·</span> : null}
              {showModel ? <b>{model.alias}</b> : null}
            </span>
          ) : null}
          {realtime ? (
            <span className="capsule-metric mono">
              {(model.realtimeTps ?? 0) < 0.5 ? '<1' : Math.round(model.realtimeTps ?? 0)} tok/s
            </span>
          ) : lastWithin ? (
            <span className="capsule-metric mono last">
              {(model.lastTps ?? 0) < 0.5 ? '<1' : Math.round(model.lastTps ?? 0)} tok/s
            </span>
          ) : null}
          {showCost ? <span className="capsule-cost mono">{fmtMoney(model.today.cost, model.currency)}</span> : null}
        </>
      ) : (
        <span className="capsule-empty">未选择模型 · 右键选择</span>
      )}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Capsule />)
