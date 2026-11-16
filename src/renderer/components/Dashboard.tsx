import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { ConfigView, LiveSnapshot, ModelLive } from '../../shared/types'
import { fmtMoney, fmtMs, fmtPct, fmtTokens } from '../format'
import { useColumnWidths } from '../columns'
import { MultiRate, rateColor } from './MultiRate'
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

function ChartPanel(props: { title: string; buckets: number[]; reqPerSec?: string }): JSX.Element {
  const { title, buckets, reqPerSec } = props
  const view = buckets.length ? buckets : [0]
  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        {reqPerSec !== undefined ? <span className="chart-now">{reqPerSec}</span> : null}
      </div>
      <div className="chart-body">
        <Sparkline buckets={view} tail={view.length} />
      </div>
    </div>
  )
}

export function Dashboard({ snapshot, config, notify, onChanged, onOpenLogs }: Props): JSX.Element {
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const cols = useColumnWidths('dashboard', [200, 120, 95, 70, 70, 70, 100, 80, 80, 80, 80, 90, 34])

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
  // 颜色按完整列表的位置分配，隐藏某条曲线不会让其他模型换色
  const colors: Record<string, string> = {}
  models.forEach((m, i) => {
    colors[m.modelId] = rateColor(i)
  })
  const rateModels = models.filter((m) => m.showRate !== false)
  // 请求速率取最近 10 秒均值，避免空闲时恒为 0
  const tailReq = (snapshot?.totals.reqBuckets ?? []).slice(-10)
  const reqPerSec = tailReq.reduce((a, b) => a + b, 0) / 10
  // 标题旁的实时值：速率=各模型实时估算之和，请求量=每秒请求数（<0.1 显 <0.1，为零显 0）
  const realtimeTps = models.reduce((a, m) => a + (m.realtimeTps ?? 0), 0)
  const realtimeText = realtimeTps > 0 ? `${Math.round(realtimeTps)} tok/s` : '0 tok/s'
  const reqPerSecText = reqPerSec > 0 && reqPerSec < 0.1 ? '<0.1 次/秒' : `${Math.round(reqPerSec * 10) / 10} 次/秒`

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
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">速率</span>
            <span className="chart-now">{realtimeText}</span>
          </div>
          <div className="chart-body">
            <MultiRate models={rateModels} colors={colors} />
          </div>
        </div>
        <ChartPanel title="请求量" buckets={snapshot?.totals.reqBuckets ?? []} reqPerSec={reqPerSecText} />
      </div>

      <div className="card">
        <table className={`tbl tbl-flush${cols.fixed ? ' col-fixed' : ''}`} {...cols.tableProps}>
          {cols.colgroup}
          <thead>
            <tr>
              <th className="c-model">模型{cols.resizer(0)}</th>
              <th className="c-url">供应商{cols.resizer(1)}</th>
              <th className="c-rate">TPS{cols.resizer(2)}</th>
              <th className="c-ttft"><span className="hd-ttft">TTFT </span>P50{cols.resizer(3)}</th>
              <th className="c-ttft"><span className="hd-ttft">TTFT </span>P95{cols.resizer(4)}</th>
              <th className="c-ttft"><span className="hd-ttft">TTFT </span>P99{cols.resizer(5)}</th>
              <th className="c-hit"><span className="hd-cache">缓存</span>命中率{cols.resizer(6)}</th>
              <th className="c-tok">未缓存输入{cols.resizer(7)}</th>
              <th className="c-tok">缓存读取{cols.resizer(8)}</th>
              <th className="c-tok">缓存输入{cols.resizer(9)}</th>
              <th className="c-tok">输出{cols.resizer(10)}</th>
              <th className="c-cost">费用{cols.resizer(11)}</th>
              <th className="c-drag">{cols.resizer(12)}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m: ModelLive) => {
              const running = probing[m.modelId] === true || m.probing
              return (
                <tr
                    key={m.modelId}
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
                    <td className="c-model">
                      <span
                        className={
                          'probe-dot' +
                          (m.lastProbeAt === null ? '' : m.lastProbeOk ? ' on' : ' off') +
                          (m.autoProbe ? '' : ' idle')
                        }
                        title={
                          m.lastProbeAt
                            ? `上次探针：${new Date(m.lastProbeAt).toLocaleTimeString()}`
                            : m.autoProbe
                              ? '尚未探测'
                              : '自动探针未开启'
                        }
                      />
                      <span className="model-name" style={{ '--mc': colors[m.modelId] } as CSSProperties}>
                        {m.alias}
                      </span>
                    </td>
                    <td className="c-url" title={`${m.providerName} ${m.baseUrl}`}>
                      {m.providerName}
                    </td>
                    <td className="c-rate mono">{m.lastTps === null ? '—' : Math.round(m.lastTps)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP50)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP95)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP99)}</td>
                    <td
                      className="c-hit mono"
                      title={m.today.cacheReadReported > 0 ? `缓存读取 ${fmtTokens(m.today.cacheRead)} / 输入 ${fmtTokens(m.today.input)}` : '渠道未上报缓存读计数'}
                    >
                      {fmtPct(m.hitRate)}
                    </td>
                    <td className="c-tok mono">{fmtTokens(m.today.uncachedInput)}</td>
                    <td className="c-tok mono">{m.today.cacheReadReported > 0 ? fmtTokens(m.today.cacheRead) : '—'}</td>
                    <td className="c-tok mono">{m.today.cacheInputReported > 0 ? fmtTokens(m.today.cacheInput) : '—'}</td>
                    <td className="c-tok mono">{fmtTokens(m.today.output)}</td>
                    <td className="c-cost mono">{fmtMoney(m.today.cost, m.currency)}</td>
                    <td className="c-drag">
                      <span
                        className="grip"
                        draggable
                        title="拖动排序"
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.dataTransfer?.setData('text/plain', m.modelId)
                          setDragId(m.modelId)
                        }}
                        onDragEnd={() => setDragId(null)}
                      >
                        ⋮⋮
                      </span>
                    </td>
                  </tr>
              )
            })}
            {models.length === 0 ? (
              <tr>
                      <td colSpan={13} className="empty">
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
          <button
            onClick={async () => {
              const target = config.models.find((m) => m.id === menu.modelId)
              setMenu(null)
              if (!target) return
              const res = await window.api.updateModel(target.id, { showRate: target.showRate === false })
              if (!res.ok) notify(res.error ?? '切换失败')
              else await onChanged()
            }}
          >
            {config.models.find((m) => m.id === menu.modelId)?.showRate === false ? '显示曲线图' : '隐藏曲线图'}
          </button>
          <button onClick={() => onOpenLogs(menu.modelId)}>查看日志</button>
        </div>
      ) : null}
    </div>
  )
}
