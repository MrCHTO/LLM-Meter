import { Fragment, useState } from 'react'
import type { ConfigView, LiveSnapshot, ModelLive, ProbeResult, RequestEvent } from '../../shared/types'
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

  if (rows === null) {
    void window.api.recent(modelId, 20).then((res) => setRows(res.ok && res.data ? res.data : []))
  }

  if (!rows || rows.length === 0) return <div className="detail empty">还没有请求记录</div>

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

export function Dashboard({ snapshot, config, notify, onChanged }: Props): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, ProbeResult>>({})

  const runProbe = async (modelId: string): Promise<void> => {
    setProbing((m) => ({ ...m, [modelId]: true }))
    const res = await window.api.runProbe(modelId)
    setProbing((m) => ({ ...m, [modelId]: false }))
    if (res.ok && res.data) {
      const data = res.data
      setResults((m) => ({ ...m, [modelId]: data }))
      notify(
        `${data.alias}：${data.message}（冷 ${fmtMs(data.cold.ttftMs)} / 热 ${fmtMs(data.warm.ttftMs)}）`,
        data.cacheEffective ? 'ok' : 'bad'
      )
    } else {
      notify(res.error ?? '测速失败')
    }
    await onChanged()
  }

  const models = snapshot?.models ?? []

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
      <div className="kpi">
        <div className="tile">
          <div className="label">合计 tok/s</div>
          <div className="value mono">{snapshot ? snapshot.totals.tps.toFixed(1) : '0.0'}</div>
        </div>
        <div className="tile">
          <div className="label">平均命中率</div>
          <div className="value mono">{fmtPct(snapshot?.totals.hitRate ?? null)}</div>
        </div>
        <div className="tile">
          <div className="label">今日成本</div>
          <div className="value mono">
            {fmtMoney(snapshot?.totals.todayCost ?? 0, snapshot?.totals.currency ?? 'USD')}
            {snapshot?.totals.budgetSum ? (
              <span className="hint"> / {fmtMoney(snapshot.totals.budgetSum, snapshot.totals.currency)}</span>
            ) : null}
          </div>
        </div>
        <div className="tile">
          <div className="label">今日请求 / 错误</div>
          <div className="value mono">
            {snapshot?.totals.requests ?? 0}
            <span className={snapshot && snapshot.totals.errors > 0 ? 'pill bad' : 'pill'}>
              {' '}
              {snapshot?.totals.errors ?? 0} 错
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>按模型</h2>
        <table>
          <thead>
            <tr>
              <th>模型</th>
              <th>tok/s</th>
              <th>TTFT</th>
              <th>命中率</th>
              <th>今日 入/出</th>
              <th>今日成本</th>
              <th>错误</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((m: ModelLive) => {
              const budget = budgetClass(m.budgetRatio)
              const result = results[m.modelId]
              return (
                <Fragment key={m.modelId}>
                  <tr>
                    <td>
                      <div className="cell-model">
                        <b>{m.alias}</b>
                        <small>
                          {m.providerName} · {m.format === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                          {m.lastError ? ` · ${m.lastError}` : ''}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="rate">
                        <span className="mono">{m.tps.toFixed(1)}</span>
                        <Sparkline buckets={m.buckets} tail={30} />
                      </div>
                    </td>
                    <td className="mono">{fmtMs(m.lastTtftMs)}</td>
                    <td className="mono">{fmtPct(m.hitRate)}</td>
                    <td className="mono">
                      {fmtTokens(m.today.input)} / {fmtTokens(m.today.output)}
                    </td>
                    <td className="mono">
                      {fmtMoney(m.today.cost, m.currency)}
                      {m.dailyBudget ? (
                        <div className={`meter ${budget}`}>
                          <div style={{ width: `${Math.min(100, (m.budgetRatio ?? 0) * 100)}%` }} />
                        </div>
                      ) : null}
                    </td>
                    <td>{m.today.errors > 0 ? <span className="pill bad">{m.today.errors}</span> : '—'}</td>
                    <td>
                      <button className="btn sm" onClick={() => setOpen(open === m.modelId ? null : m.modelId)}>
                        {open === m.modelId ? '收起' : '明细'}
                      </button>{' '}
                      <button
                        className="btn sm"
                        disabled={probing[m.modelId] || m.probing || m.paused}
                        title={m.paused ? '探针已暂停' : undefined}
                        onClick={() => void runProbe(m.modelId)}
                      >
                        {probing[m.modelId] || m.probing ? '测速中' : '测速'}
                      </button>
                    </td>
                  </tr>
                  {result ? (
                    <tr>
                      <td colSpan={8}>
                        <div className={`detail ${result.cacheEffective ? '' : 'err-line'}`}>
                          {result.message} · 冷：{fmtMs(result.cold.ttftMs)} {result.cold.tps?.toFixed(1) ?? '—'} tok/s 缓存{' '}
                          {result.cold.cacheReadTokens} · 热：{fmtMs(result.warm.ttftMs)} {result.warm.tps?.toFixed(1) ?? '—'} tok/s 缓存{' '}
                          {result.warm.cacheReadTokens}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {open === m.modelId ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 0 }}>
                        <Recent modelId={m.modelId} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
            {models.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">
                  还没有启用的模型
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
