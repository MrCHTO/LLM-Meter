import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppLog, ConfigView, LogPage, LogQuery, RequestLog } from '../../shared/types'
import { fmtClock, fmtMoney, fmtMs, fmtTokens } from '../format'
import { useColumnWidths } from '../columns'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  initialModelId?: string | null
}

type Kind = 'request' | 'app'
type Preset = '1h' | '24h' | '7d' | 'custom'

const PAGE_SIZE = 100

function tpsOf(row: RequestLog): string {
  if (!row.ok || row.outputTokens <= 0) return '—'
  const ms = row.durationMs - (row.ttftMs ?? 0)
  if (ms <= 0) return '—'
  return (row.outputTokens / (ms / 1000)).toFixed(0)
}

function rangeOf(preset: Preset, from: string, to: string): { from: number; to: number } | null {
  const now = Date.now()
  if (preset === '1h') return { from: now - 3_600_000, to: now }
  if (preset === '24h') return { from: now - 86_400_000, to: now }
  if (preset === '7d') return { from: now - 7 * 86_400_000, to: now }
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

function localInput(ts: number): string {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function Logs({ config, notify, initialModelId }: Props): JSX.Element {
  const [kind, setKind] = useState<Kind>('request')
  const [preset, setPreset] = useState<Preset>('24h')
  const [customFrom, setCustomFrom] = useState(() => localInput(Date.now() - 86_400_000))
  const [customTo, setCustomTo] = useState(() => localInput(Date.now()))
  const [modelId, setModelId] = useState(initialModelId ?? '')
  const [source, setSource] = useState<'all' | 'proxy' | 'probe'>('all')
  const [result, setResult] = useState<'all' | 'ok' | 'fail'>('all')
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [keyword, setKeyword] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<LogPage<RequestLog> | LogPage<AppLog> | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const requestCols = useColumnWidths('log-requests', [90, 120, 110, 60, 60, 70, 70, 70, 70, 70, 70, 80])
  const appCols = useColumnWidths('log-apps', [90, 60, 90, 600])

  useEffect(() => {
    setModelId(initialModelId ?? '')
    setPage(1)
  }, [initialModelId])

  const load = useCallback(async (): Promise<void> => {
    const range = rangeOf(preset, customFrom, customTo)
    if (!range) {
      notify('自定义时间格式不对')
      return
    }
    const query: LogQuery = {
      ...range,
      keyword: applied,
      page,
      pageSize: PAGE_SIZE,
      ...(kind === 'request'
        ? { modelId: modelId || undefined, source: source === 'all' ? undefined : source, ok: result === 'all' ? undefined : result === 'ok' }
        : { level: level === 'all' ? undefined : level })
    }
    const mine = ++seq.current
    setLoading(true)
    const res = kind === 'request' ? await window.api.logRequests(query) : await window.api.logApps(query)
    if (mine !== seq.current) return
    setLoading(false)
    if (res.ok && res.data) setData(res.data)
    else {
      setData({ rows: [], total: 0 })
      if (res.error) notify(res.error)
    }
  }, [preset, customFrom, customTo, applied, page, kind, modelId, source, result, level, notify])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  const switchKind = (next: Kind): void => {
    if (next === kind) return
    setKind(next)
    setData(null)
    setPage(1)
  }

  const resetPage = (): void => setPage(1)

  return (
    <div className="section">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">
            <button
              role="tab"
              className="tab"
              aria-selected={kind === 'request'}
              onClick={() => switchKind('request')}
            >
              请求日志
            </button>
            <button role="tab" className="tab" aria-selected={kind === 'app'} onClick={() => switchKind('app')}>
              运行日志
            </button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {kind === 'app' ? (
              <button
                className="btn"
                onClick={async () => {
                  const res = await window.api.calibrate()
                  if (!res.ok) notify(res.error ?? '校准失败')
                  await load()
                }}
              >
                立即校准
              </button>
            ) : null}
            <button className="btn" disabled={loading} onClick={() => void load()}>
              刷新
            </button>
          </div>
        </div>

        <div className="row log-filters">
          <label className="field w-sm">
            <span>时间范围</span>
            <select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as Preset)
                resetPage()
              }}
            >
              <option value="1h">最近 1 小时</option>
              <option value="24h">最近 24 小时</option>
              <option value="7d">最近 7 天</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          {preset === 'custom' ? (
            <>
              <label className="field">
                <span>从</span>
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value)
                    resetPage()
                  }}
                />
              </label>
              <label className="field">
                <span>到</span>
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value)
                    resetPage()
                  }}
                />
              </label>
            </>
          ) : null}
          {kind === 'request' ? (
            <>
              <label className="field">
                <span>模型</span>
                <select
                  value={modelId}
                  onChange={(e) => {
                    setModelId(e.target.value)
                    resetPage()
                  }}
                >
                  <option value="">全部</option>
                  {config.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.alias}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field w-sm">
                <span>来源</span>
                <select
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as typeof source)
                    resetPage()
                  }}
                >
                  <option value="all">全部</option>
                  <option value="proxy">代理</option>
                  <option value="probe">探针</option>
                </select>
              </label>
              <label className="field w-sm">
                <span>结果</span>
                <select
                  value={result}
                  onChange={(e) => {
                    setResult(e.target.value as typeof result)
                    resetPage()
                  }}
                >
                  <option value="all">全部</option>
                  <option value="ok">成功</option>
                  <option value="fail">失败</option>
                </select>
              </label>
            </>
          ) : (
            <label className="field w-sm">
              <span>级别</span>
              <select
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value as typeof level)
                  resetPage()
                }}
              >
                <option value="all">全部</option>
                <option value="info">普通</option>
                <option value="warn">警告</option>
                <option value="error">错误</option>
              </select>
            </label>
          )}
          <label className="field grow">
            <span>关键字</span>
            <div className="row nowrap">
              <input
                type="text"
                className="grow"
                value={keyword}
                placeholder={kind === 'request' ? '别名、上游模型、供应商、备注' : '范围或内容'}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  setApplied(keyword)
                  resetPage()
                }}
              />
              <button
                className="btn"
                onClick={() => {
                  setApplied(keyword)
                  resetPage()
                }}
              >
                查询
              </button>
            </div>
          </label>
        </div>

        {!data ? (
          <div className="empty">读取中…</div>
        ) : data.rows.length === 0 ? (
          <div className="empty">没有符合条件的日志</div>
        ) : kind === 'request' ? (
          <table className={`tbl tbl-flush tbl-log tbl-request${requestCols.fixed ? ' col-fixed' : ''}`} {...requestCols.tableProps}>
            {requestCols.colgroup}
            <thead>
              <tr>
                <th>时间{requestCols.resizer(0)}</th>
                <th>模型{requestCols.resizer(1)}</th>
                <th>供应商{requestCols.resizer(2)}</th>
                <th>来源{requestCols.resizer(3)}</th>
                <th>状态{requestCols.resizer(4)}</th>
                <th>未缓存输入{requestCols.resizer(5)}</th>
                <th>缓存读取{requestCols.resizer(6)}</th>
                <th>缓存输入{requestCols.resizer(7)}</th>
                <th>输出{requestCols.resizer(8)}</th>
                <th>TTFT{requestCols.resizer(9)}</th>
                <th>tok/s{requestCols.resizer(10)}</th>
                <th>成本{requestCols.resizer(11)}</th>
              </tr>
            </thead>
            <tbody>
              {(data.rows as RequestLog[]).map((row) => (
                <tr key={row.id}>
                  <td className="mono">{fmtClock(row.ts)}</td>
                  <td title={row.upstreamModel}>{row.alias}</td>
                  <td>{row.providerName}</td>
                  <td>{row.source === 'probe' ? '探针' : '代理'}</td>
                  <td>
                    {row.ok ? <span className="pill ok">ok</span> : <span className="pill bad">{row.status || 'err'}</span>}
                  </td>
                  <td className="mono">{fmtTokens(row.uncachedInputTokens)}</td>
                  <td className="mono">{row.cacheReadReported ? fmtTokens(row.cacheReadTokens) : '—'}</td>
                  <td className="mono">{row.cacheInputReported ? fmtTokens(row.cacheInputTokens) : '—'}</td>
                  <td className="mono">{fmtTokens(row.outputTokens)}</td>
                  <td className="mono">{fmtMs(row.ttftMs)}</td>
                  <td className="mono">{tpsOf(row)}</td>
                  <td className="mono">{fmtMoney(row.cost, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className={`tbl tbl-flush tbl-log${appCols.fixed ? ' col-fixed' : ''}`} {...appCols.tableProps}>
            {appCols.colgroup}
            <thead>
              <tr>
                <th>时间{appCols.resizer(0)}</th>
                <th>级别{appCols.resizer(1)}</th>
                <th>范围{appCols.resizer(2)}</th>
                <th>内容{appCols.resizer(3)}</th>
              </tr>
            </thead>
            <tbody>
              {(data.rows as AppLog[]).map((row) => (
                <tr key={row.id}>
                  <td className="mono">{fmtClock(row.ts)}</td>
                  <td>
                    <span className={`pill${row.level === 'error' ? ' bad' : row.level === 'warn' ? ' warn' : ''}`}>
                      {row.level === 'error' ? '错误' : row.level === 'warn' ? '警告' : '普通'}
                    </span>
                  </td>
                  <td>{row.scope}</td>
                  <td className="log-note selectable">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="row log-pager">
          <span className="muted">
            共 {data?.total ?? 0} 条 · 第 {page} / {pages} 页
          </span>
          <button className="btn sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <button className="btn sm" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      </div>
    </div>
  )
}
