import { Fragment, useCallback, useEffect, useState } from 'react'
import type { ConfigView, LiveSnapshot, ModelLive, RequestEvent } from '../../shared/types'
import { FORMAT_LABEL } from '../../shared/types'
import { budgetClass, fmtClock, fmtMoney, fmtMs, fmtPct, fmtTokens } from '../format'
import { Sparkline } from './Sparkline'

interface Props {
  snapshot: LiveSnapshot | null
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

function Recent({ modelId }: { modelId: string }): JSX.Element {
  const [rows, setRows] = useState<RequestEvent[] | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.recent(modelId, 20).then((res) => {
      if (alive) setRows(res.ok && res.data ? res.data : [])
    })
    return () => {
      alive = false
    }
  }, [modelId])

  if (!rows) return <div className="detail">读取中…</div>
  if (rows.length === 0) return <div className="detail">还没有请求记录</div>

  return (
    <div className="detail">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>来源</th>
            <th>状态</th>
            <th>输入</th>
            <th>输出</th>
            <th>TTFT</th>
            <th>成本</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ev) => (
            <tr key={ev.id}>
              <td className="mono">{fmtClock(ev.ts)}</td>
              <td>{ev.source === 'probe' ? '测速' : '代理'}</td>
              <td>{ev.ok ? <span className="pill ok">ok</span> : <span className="pill bad">{ev.status || 'err'}</span>}</td>
              <td className="mono">{fmtTokens(ev.inputTokens)}</td>
              <td className="mono">{fmtTokens(ev.outputTokens)}</td>
              <td className="mono">{fmtMs(ev.ttftMs)}</td>
              <td className="mono">{fmtMoney(ev.cost, ev.currency)}</td>
              <td className="err-line">{ev.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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

export function Dashboard({ snapshot, config, notify, onChanged }: Props): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)

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
        <ChartPanel title="TPS" buckets={snapshot?.totals.buckets ?? []} rate="tok/s" />
        <ChartPanel title="请求量" buckets={snapshot?.totals.reqBuckets ?? []} rate="次/s" />
      </div>

      <div className="card">
        <table className="tbl tbl-flush">
          <thead>
            <tr>
              <th className="c-model">模型</th>
              <th className="c-url">上游供应商/地址</th>
              <th className="c-format">上游协议</th>
              <th className="c-rate">TPS</th>
              <th className="c-ttft">TTFT</th>
              <th className="c-hit">缓存命中率</th>
              <th className="c-tok">输入</th>
              <th className="c-tok">输出</th>
              <th className="c-cost">费用</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m: ModelLive) => {
              const budget = budgetClass(m.budgetRatio)
              const isOpen = open === m.modelId
              const running = probing[m.modelId] === true || m.probing
              return (
                <Fragment key={m.modelId}>
                  <tr
                    className={[
                      'clickable',
                      isOpen && 'open',
                      running && 'probing',
                      flash[m.modelId] && 'bad-flash'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setOpen(isOpen ? null : m.modelId)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu({ modelId: m.modelId, x: event.clientX, y: event.clientY })
                    }}
                  >
                    <td className="c-model">
                      <div className="cell-model">
                        <b>{m.alias}</b>
                        <small className="mono">{m.upstreamModel}</small>
                      </div>
                    </td>
                    <td className="c-url" title={`${m.providerName} ${m.baseUrl}`}>
                      <div className="cell-model">
                        <span>{m.providerName}</span>
                        <small className="mono ellipsis">{m.baseUrl}</small>
                      </div>
                    </td>
                    <td className="c-format">{FORMAT_LABEL[m.format]}</td>
                    <td className="c-rate">
                      <div className="rate">
                        <span className="mono">{Math.round(m.tps)}</span>
                        <Sparkline buckets={m.buckets} tail={18} />
                      </div>
                    </td>
                    <td className="c-ttft mono">{fmtMs(m.lastTtftMs)}</td>
                    <td className="c-hit mono">{fmtPct(m.hitRate)}</td>
                    <td className="c-tok mono">{fmtTokens(m.today.input)}</td>
                    <td className="c-tok mono">{fmtTokens(m.today.output)}</td>
                    <td className="c-cost mono">
                      {fmtMoney(m.today.cost, m.currency)}
                      {m.dailyBudget ? (
                        <div className={`meter ${budget}`}>
                          <div style={{ width: `${Math.min(100, (m.budgetRatio ?? 0) * 100)}%` }} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="detail-row">
                      <td colSpan={9} style={{ padding: 0 }}>
                        <Recent modelId={m.modelId} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
            {models.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">
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
          <button onClick={() => setOpen(open === menu.modelId ? null : menu.modelId)}>
            {open === menu.modelId ? '收起明细' : '展开明细'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
