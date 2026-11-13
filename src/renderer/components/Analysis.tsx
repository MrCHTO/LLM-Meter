import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigView, StatsGranularity, StatsGroup, StatsMetric, StatsRow, StatsSeries, StatsSource } from '../../shared/types'
import { fmtMoney, fmtMs, fmtTokens } from '../format'
import { SeriesChart, type SeriesItem } from './SeriesChart'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
}

type Preset = 'today' | '24h' | '7d' | 'custom'

const METRICS: { id: StatsMetric; label: string; unit: string; digits: number }[] = [
  { id: 'requests', label: '请求数', unit: '次', digits: 0 },
  { id: 'tps', label: 'tok/s', unit: 'tok/s', digits: 1 },
  { id: 'input', label: '输入 token', unit: '个', digits: 0 },
  { id: 'output', label: '输出 token', unit: '个', digits: 0 },
  { id: 'total', label: '总 token', unit: '个', digits: 0 },
  { id: 'cache_read', label: '缓存读 token', unit: '个', digits: 0 },
  { id: 'cost', label: '成本', unit: '¥', digits: 2 },
  { id: 'errors', label: '错误数', unit: '次', digits: 0 }
]

const COLORS = ['#1f6feb', '#0f9d63', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#c026d3']

function rangeOf(preset: Preset, customFrom: string, customTo: string): { from: number; to: number } | null {
  const now = Date.now()
  if (preset === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return { from: start.getTime(), to: now }
  }
  if (preset === '24h') return { from: now - 86_400_000, to: now }
  if (preset === '7d') return { from: now - 7 * 86_400_000, to: now }
  if (!customFrom || !customTo) return null
  const from = new Date(customFrom).getTime()
  const to = new Date(customTo).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null
  return { from, to: Math.min(to, now) }
}

function granularityOf(span: number): StatsGranularity {
  if (span <= 2 * 3_600_000) return 'minute'
  if (span <= 48 * 3_600_000) return 'hour'
  return 'day'
}

export function Analysis({ config, notify }: Props): JSX.Element {
  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [metric, setMetric] = useState<StatsMetric>('requests')
  const [groupBy, setGroupBy] = useState<StatsGroup>('model')
  const [source, setSource] = useState<StatsSource>('proxy')
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [series, setSeries] = useState<StatsSeries | null>(null)
  const [totals, setTotals] = useState<StatsRow[]>([])
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const range = rangeOf(preset, customFrom, customTo)
  const granularity = range ? granularityOf(range.to - range.from) : 'hour'
  const meta = METRICS.find((m) => m.id === metric) ?? (METRICS[0] as (typeof METRICS)[number])

  const fmt = useCallback(
    (v: number): string => {
      if (metric === 'cost') return fmtMoney(v)
      if (metric === 'tps') return v.toFixed(1)
      return fmtTokens(v)
    },
    [metric]
  )

  const timeFormat = useCallback(
    (ts: number): string => {
      const d = new Date(ts)
      const p = (n: number): string => String(n).padStart(2, '0')
      if (granularity === 'day') return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
      return `${p(d.getHours())}:${p(d.getMinutes())}`
    },
    [granularity]
  )

  const load = useCallback(
    async (silent = false): Promise<void> => {
      // 每次现算区间：预设的右端要跟着当前时间走，否则轮询永远查旧窗口
      const r = rangeOf(preset, customFrom, customTo)
      if (!r) {
        setSeries(null)
        setTotals([])
        return
      }
      if (inFlight.current) return
      inFlight.current = true
      // 轮询走静默：不换按钮文案，失败也不弹提示
      if (!silent) setBusy(true)
      try {
        const q = { from: r.from, to: r.to, source }
        const [s, t] = await Promise.all([
          window.api.statsSeries({ ...q, granularity: granularityOf(r.to - r.from), metric, groupBy }),
          window.api.statsTotals({ ...q, groupBy })
        ])
        if (s.ok && s.data) setSeries(s.data)
        else if (!silent) notify(s.error ?? '查询失败')
        if (t.ok && t.data) setTotals(t.data)
      } finally {
        inFlight.current = false
        if (!silent) setBusy(false)
      }
    },
    [preset, customFrom, customTo, source, metric, groupBy, notify]
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (preset === 'custom') return
    const timer = setInterval(() => void load(true), 5000)
    return () => clearInterval(timer)
  }, [load, preset])

  const items: SeriesItem[] = useMemo(
    () =>
      (series?.series ?? []).map((s, i) => ({
        key: s.key,
        label: s.label,
        points: s.points,
        color: COLORS[i % COLORS.length] as string,
        hidden: hidden[s.key] === true
      })),
    [series, hidden]
  )

  const totalOf = (pick: (r: StatsRow) => number): number => totals.reduce((a, r) => a + pick(r), 0)
  const top = useMemo(() => [...totals].sort((a, b) => b.cost - a.cost).slice(0, 10), [totals])

  const exportCsv = async (): Promise<void> => {
    if (!range) {
      notify('先选有效区间')
      return
    }
    const res = await window.api.statsExport({ from: range.from, to: range.to, source })
    if (res.ok && res.data) notify(`已导出 ${res.data.rows} 行到 ${res.data.path}`, 'ok')
    else if (res.error && res.error !== '已取消') notify(res.error)
  }

  return (
    <div className="section">
      <div className="card">
        <div className="row nowrap" style={{ gap: 10 }}>
          <label className="field">
            <span>时间范围</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="today">今天</option>
              <option value="24h">近 24 小时</option>
              <option value="7d">近 7 天</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          {preset === 'custom' ? (
            <>
              <label className="field">
                <span>从</span>
                <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="field">
                <span>到</span>
                <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </>
          ) : null}
          <label className="field">
            <span>指标</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value as StatsMetric)}>
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>分组</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as StatsGroup)}>
              <option value="model">按模型</option>
              <option value="provider">按供应商</option>
            </select>
          </label>
          <label className="field">
            <span>来源</span>
            <select value={source} onChange={(e) => setSource(e.target.value as StatsSource)}>
              <option value="proxy">真实流量</option>
              <option value="probe">仅测速</option>
              <option value="all">全部</option>
            </select>
          </label>
          <div className="row nowrap" style={{ marginLeft: 'auto', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => void load()}>
              {busy ? '查询中' : '刷新'}
            </button>
            <button className="btn" onClick={() => void exportCsv()}>
              导出 CSV
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>{meta.label}</h2>
          <span className="muted">
            {groupBy === 'model' ? '按模型' : '按供应商'} · {granularity === 'day' ? '按天' : granularity === 'hour' ? '按小时' : '按分钟'}
            {preset !== 'custom' ? ' · 每 5 秒刷新' : ''}
          </span>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            区间合计 {fmt(totalOf((r) => (metric === 'cost' ? r.cost : metric === 'tps' ? (r.tps ?? 0) : metric === 'total' ? r.total : (r[metric === 'cache_read' ? 'cacheRead' : metric] as number))))} {meta.unit}
          </span>
        </div>
        <SeriesChart
          buckets={series?.buckets ?? []}
          series={items}
          format={fmt}
          integer={meta.digits === 0}
          timeFormat={timeFormat}
          onToggle={(key) => setHidden((h) => ({ ...h, [key]: !h[key] }))}
        />
      </div>

      <div className="card">
        <h2>分组明细</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th className="c-model">{groupBy === 'model' ? '模型' : '供应商'}</th>
              <th>请求</th>
              <th>错误</th>
              <th>输入</th>
              <th>输出</th>
              <th>总 token</th>
              <th>缓存读</th>
              <th>TTFT P50</th>
              <th>TTFT P95</th>
              <th>TTFT P99</th>
              <th>tok/s</th>
              <th>成本</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.key}>
                <td className="c-model">{r.label}</td>
                <td className="mono">{fmtTokens(r.requests)}</td>
                <td className="mono">{r.errors || '—'}</td>
                <td className="mono">{fmtTokens(r.input)}</td>
                <td className="mono">{fmtTokens(r.output)}</td>
                <td className="mono">{fmtTokens(r.total)}</td>
                <td className="mono">{fmtTokens(r.cacheRead)}</td>
                <td className="mono">{fmtMs(r.ttftP50)}</td>
                <td className="mono">{fmtMs(r.ttftP95)}</td>
                <td className="mono">{fmtMs(r.ttftP99)}</td>
                <td className="mono">{r.tps === null ? '—' : r.tps.toFixed(1)}</td>
                <td className="mono">{fmtMoney(r.cost)}</td>
              </tr>
            ))}
            {totals.length === 0 ? (
              <tr>
                <td colSpan={12} className="empty">
                  {range ? '这个区间没有数据' : '选一个合法区间'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <span className="muted">按成本取前 10；共 {totals.length} 组</span>
      </div>
    </div>
  )
}
