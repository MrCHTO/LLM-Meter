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

  const watched = snapshot?.overlayModelId
    ? snapshot.models.find((m) => m.modelId === snapshot.overlayModelId)
    : undefined
  const isGlobal = snapshot?.overlay.global === true && (snapshot?.models.length ?? 0) > 0
  const models = snapshot?.models ?? []
  const model = isGlobal ? undefined : watched
  const busy = isGlobal ? models.some((m) => m.active) : watched?.active === true || watched?.probing === true

  // 速度按「正在生成」实时求和；全部停下后 5 分钟内灰显各自上一条的和
  const withinLast = (m: { lastTps: number | null; lastTpsAt: number | null }): boolean =>
    m.lastTps !== null && m.lastTpsAt !== null && Date.now() - m.lastTpsAt < 5 * 60_000
  const singleRealtime =
    watched !== undefined && (watched.inflight > 0 || watched.probing) && watched.realtimeTps !== null
  const globalRealtime = models.some((m) => (m.inflight > 0 || m.probing) && m.realtimeTps !== null)
    ? models.reduce((a, m) => a + (m.inflight > 0 || m.probing ? (m.realtimeTps ?? 0) : 0), 0)
    : null
  const rateNow = isGlobal ? globalRealtime : singleRealtime ? (watched?.realtimeTps ?? 0) : null
  const rateLast = isGlobal
    ? rateNow === null && models.some(withinLast)
      ? models.reduce((a, m) => a + (withinLast(m) ? (m.lastTps ?? 0) : 0), 0)
      : null
    : rateNow === null && watched !== undefined && withinLast(watched)
      ? (watched.lastTps ?? 0)
      : null

  // 点的语义与仪表盘行首探活点一致；全局按聚合健康：任一失败红，全部成功绿，其余灰
  const dotClass = isGlobal
    ? models.some((m) => m.lastProbeAt !== null && m.lastProbeOk === false)
      ? 'off'
      : models.every((m) => m.lastProbeAt !== null && m.lastProbeOk)
        ? 'on'
        : 'idle'
    : watched
      ? watched.lastProbeAt !== null
        ? watched.lastProbeOk
          ? 'on'
          : 'off'
        : 'idle'
      : 'idle'
  const dotTitle = isGlobal
    ? '全部启用模型的最近一次探活'
    : watched
      ? watched.lastProbeAt !== null
        ? `上次探针：${new Date(watched.lastProbeAt).toLocaleTimeString()} · ${watched.lastProbeOk ? '成功' : '失败'}`
        : '尚未探测'
      : '未选择模型'

  const providerName = isGlobal ? '全局' : (model?.providerName ?? '')
  const aliasName = isGlobal ? 'Σ' : (model?.alias ?? '')
  const cost = isGlobal ? models.reduce((a, m) => a + m.today.cost, 0) : (model?.today.cost ?? 0)
  const currency = isGlobal ? (models[0]?.currency ?? 'CNY') : (model?.currency ?? 'CNY')
  const hasTarget = isGlobal || model !== undefined
  const fmtRate = (v: number): string => (v < 0.5 ? '<1' : String(Math.round(v)))

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
      <span className={`capsule-dot ${dotClass}`} title={dotTitle} />

      {hasTarget ? (
        <>
          {showProvider || showModel ? (
            <span className="capsule-name">
              {showProvider ? <span className="capsule-source">{providerName}</span> : null}
              {showProvider && showModel ? <span className="capsule-sep">·</span> : null}
              {showModel ? <b>{aliasName}</b> : null}
            </span>
          ) : null}
          {rateNow !== null ? (
            <span className="capsule-metric mono">{fmtRate(rateNow)} tok/s</span>
          ) : rateLast !== null ? (
            <span className="capsule-metric mono last">{fmtRate(rateLast)} tok/s</span>
          ) : null}
          {showCost ? <span className="capsule-cost mono">{fmtMoney(cost, currency)}</span> : null}
        </>
      ) : (
        <span className="capsule-empty">未选择模型 · 右键选择</span>
      )}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Capsule />)
