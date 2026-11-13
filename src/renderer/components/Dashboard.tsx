import { useCallback, useEffect, useState } from 'react'
import type { ConfigView, LiveSnapshot, ModelLive } from '../../shared/types'
import { fmtMoney, fmtMs, fmtPct, fmtTokens } from '../format'
import { Sparkline } from './Sparkline'

interface Props {
  snapshot: LiveSnapshot | null
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
  onOpenLogs: (modelId: string) => void
}

interface MenuState {
  modelId: string
  x: number
  y: number
}

function ChartPanel(props: { title: string; buckets: number[]; rate: string }): JSX.Element {
  const { title, buckets, rate } = props
  const view = buckets.length ? buckets : [0]
  // 峰值取单秒最大：一次请求就是 1 次/s，不按窗口摊薄；取整不保留小数
  const peak = Math.round(Math.max(0, ...view))
  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
      </div>
      <div className="chart-body">
        <Sparkline buckets={view} tail={view.length} />
      </div>
      <div className="chart-foot mono">
        <span>
          峰值 {peak} {rate}
        </span>
      </div>
    </div>
  )
}

export function Dashboard({ snapshot, config, notify, onChanged, onOpenLogs }: Props): JSX.Element {
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])

  const [flash, setFlash] = useState<Record<string, boolean>>({})

  const runProbe = useCallback(
    async (modelId: string): Promise<void> => {
      setProbing((m) => ({ ...m, [modelId]: true }))
      setMenu(null)
      const res = await window.api.runProbe(modelId)
      setProbing((m) => ({ ...m, [modelId]: false }))
      const failed = !res.ok || !res.data?.ok
      if (res.ok && res.data) notify(`${res.data.alias}：${res.data.message}`, res.data.ok ? 'ok' : 'bad')
      else notify(res.error ?? '测速失败')
      if (failed) {
        // 失败用红底纹提示，5 秒后恢复
        setFlash((m) => ({ ...m, [modelId]: true }))
        setTimeout(() => setFlash((m) => ({ ...m, [modelId]: false })), 5000)
      }
      await onChanged()
    },
    [notify, onChanged]
  )

  const models = snapshot?.models ?? []
  // 请求速率取最近 10 秒均值，避免空闲时恒为 0
  const tailReq = (snapshot?.totals.reqBuckets ?? []).slice(-10)
  const reqPerSec = tailReq.reduce((a, b) => a + b, 0) / 10

  const dropOn = async (targetId: string, sourceId: string | null): Promise<void> => {
    if (!sourceId || sourceId === targetId) return
    const all = config.models.map((m) => m.id)
    const from = all.indexOf(sourceId)
    const to = all.indexOf(targetId)
    if (from < 0 || to < 0) return
    const ids = all.filter((id) => id !== sourceId)
    // 往下拖放到目标行之后，往上拖放到目标行之前
    ids.splice(ids.indexOf(targetId) + (from < to ? 1 : 0), 0, sourceId)
    setDragId(null)
    const res = await window.api.reorderModels(ids)
    if (!res.ok) notify(res.error ?? '排序失败')
    else await onChanged()
  }

  if (config.models.length === 0) {
    return (
      <div className="section">
        <div className="card">
          <h2>还没有模型</h2>
          <div className="kv">
            <dt>本地入口</dt>
            <dd>{snapshot?.proxyRunning ? snapshot.baseUrl : '代理未启动'}</dd>
            <dt>本地 token</dt>
            <dd>{config.settings.localTokenMasked}</dd>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="charts">
        <ChartPanel title="tok/s" buckets={snapshot?.totals.buckets ?? []} rate="tok/s" />
        <ChartPanel title="请求量" buckets={snapshot?.totals.reqBuckets ?? []} rate="次/s" />
      </div>

      <div className="card">
        <table className="tbl tbl-flush">
          <thead>
            <tr>
              <th className="c-model">模型</th>
              <th className="c-url">供应商</th>
              <th className="c-rate">tok/s</th>
              <th className="c-ttft">TTFT P50</th>
              <th className="c-ttft">TTFT P95</th>
              <th className="c-ttft">TTFT P99</th>
              <th className="c-hit">缓存命中率</th>
              <th className="c-tok">输入</th>
              <th className="c-tok">输出</th>
              <th className="c-cost">费用</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m: ModelLive) => {
              const running = probing[m.modelId] === true || m.probing
              return (
                <tr
                    key={m.modelId}
                    draggable
                    className={[
                      'clickable',
                      running && 'probing',
                      flash[m.modelId] && 'bad-flash',
                      dragId === m.modelId && 'dragging'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onOpenLogs(m.modelId)}
                    onDragStart={(e) => {
                      e.dataTransfer?.setData('text/plain', m.modelId)
                      setDragId(m.modelId)
                    }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const sourceId = e.dataTransfer?.getData('text/plain') || dragId
                      void dropOn(m.modelId, sourceId)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu({ modelId: m.modelId, x: event.clientX, y: event.clientY })
                    }}
                  >
                    <td className="c-model">{m.alias}</td>
                    <td className="c-url" title={`${m.providerName} ${m.baseUrl}`}>
                      {m.providerName}
                    </td>
                    <td className="c-rate">
                      <div className="rate">
                        <span className="mono">{m.lastTps === null ? '—' : Math.round(m.lastTps)}</span>
                        <Sparkline buckets={m.buckets} tail={18} />
                      </div>
                    </td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP50)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP95)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP99)}</td>
                    <td
                      className="c-hit mono"
                      title={`缓存读 ${fmtTokens(m.today.cacheRead)} / 输入 ${fmtTokens(m.today.input)}`}
                    >
                      {fmtPct(m.hitRate)}
                    </td>
                    <td className="c-tok mono">{fmtTokens(m.today.input)}</td>
                    <td className="c-tok mono">{fmtTokens(m.today.output)}</td>
                    <td className="c-cost mono">{fmtMoney(m.today.cost, m.currency)}</td>
                  </tr>
              )
            })}
            {models.length === 0 ? (
              <tr>
                      <td colSpan={10} className="empty">
                  还没有启用的模型
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {menu ? (
        <div
          className="ctxmenu"
          style={{ left: Math.min(menu.x, window.innerWidth - 130), top: Math.min(menu.y, window.innerHeight - 80) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => void runProbe(menu.modelId)}>测速</button>
          <button onClick={() => onOpenLogs(menu.modelId)}>查看日志</button>
        </div>
      ) : null}
    </div>
  )
}
