import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StatsGranularity, StatsGroup, StatsMetric, StatsSeries } from '../../shared/types'
import { fmtMoney, fmtTokens } from '../../shared/format'
import { dayKey, dayStart } from '../../shared/date'
import { ActivityHeatmap } from './ActivityHeatmap'
import { SeriesChart, type SeriesItem } from './SeriesChart'
import { TrendChart, type TrendSeries } from './TrendChart'
import { UsageDonut, type UsageRow } from './UsageDonut'

interface Props {
  notify: (text: string, kind?: 'ok' | 'bad') => void
}

type Preset = 'today' | '24h' | '7d' | 'custom'
type UsageRange = 7 | 30

const METRICS: { id: StatsMetric; label: string; unit: string; digits: number }[] = [
  { id: 'requests', label: '请求数', unit: '次', digits: 0 },
  { id: 'total', label: '总 token', unit: '个', digits: 0 },
  { id: 'input', label: '总输入 token', unit: '个', digits: 0 },
  { id: 'uncached', label: '未缓存输入 token', unit: '个', digits: 0 },
  { id: 'output', label: '输出 token', unit: '个', digits: 0 },
  { id: 'cost', label: '成本', unit: '¥', digits: 2 }
]

const COLORS = ['#1f6feb', '#0f9d63', '#9333ea', '#d97706', '#dc2626', '#0891b2', '#65a30d', '#c026d3']

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

const DAY_MS = 86_400_000

export function Analysis({ notify }: Props): JSX.Element {
  const [preset, setPreset] = useState<Preset>('24h')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [metric, setMetric] = useState<StatsMetric>('requests')
  const [groupBy, setGroupBy] = useState<StatsGroup>('model')
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [series, setSeries] = useState<StatsSeries | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // 用量统计：一年活动格、近 7/30 日趋势与模型占比
  const [usageRange, setUsageRange] = useState<UsageRange>(7)
  const [activity, setActivity] = useState<Map<string, number>>(new Map())
  const [usage, setUsage] = useState<{ key: string; label: string; tokens: number }[]>([])
  const [trend, setTrend] = useState<StatsSeries | null>(null)
  const [trendHidden, setTrendHidden] = useState<Record<string, boolean>>({})
  const inFlight = useRef(false)
  // 轮询与切区间可能并发，只认最后一次请求的结果
  const activitySeq = useRef(0)
  const usageSeq = useRef(0)

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
        return
      }
      if (inFlight.current) return
      inFlight.current = true
      // 轮询走静默：不换按钮文案，失败也不弹提示
      if (!silent) setBusy(true)
      try {
        const q = { from: r.from, to: r.to, source: 'proxy' as const }
        const s = await window.api.statsSeries({ ...q, granularity: granularityOf(r.to - r.from), metric, groupBy })
        if (s.ok && s.data) setSeries(s.data)
        else if (!silent) notify(s.error ?? '查询失败')
      } catch (err) {
        if (!silent) notify(err instanceof Error ? err.message : '查询失败')
      } finally {
        inFlight.current = false
        if (!silent) setBusy(false)
      }
    },
    [preset, customFrom, customTo, metric, groupBy, notify]
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (preset === 'custom') return
    const timer = setInterval(() => void load(true), 5000)
    return () => clearInterval(timer)
  }, [load, preset])

  // 活动格固定看近一年；按模型分组再在渲染层求和，便于复用现成的日聚合
  const loadActivity = useCallback(async (): Promise<void> => {
    const seq = ++activitySeq.current
    const to = Date.now()
    const from = dayStart(to - 364 * DAY_MS)
    const res = await window.api.statsSeries({
      from,
      to,
      source: 'proxy',
      granularity: 'day',
      metric: 'total',
      groupBy: 'model'
    })
    if (seq !== activitySeq.current) return
    if (!res.ok || !res.data) return
    const map = new Map<string, number>()
    res.data.buckets.forEach((bucket, i) => {
      let sum = 0
      for (const s of res.data?.series ?? []) sum += s.points[i] ?? 0
      map.set(dayKey(bucket), sum)
    })
    setActivity(map)
  }, [])

  const loadUsage = useCallback(async (): Promise<void> => {
    const seq = ++usageSeq.current
    const to = Date.now()
    const from = dayStart(to - (usageRange - 1) * DAY_MS)
    const totals = await window.api.statsTotals({ from, to, source: 'proxy', groupBy: 'model' })
    if (seq !== usageSeq.current) return
    if (!totals.ok || !totals.data) return
    setUsage(
      totals.data
        .map((r) => ({ key: r.key, label: r.label, tokens: r.total }))
        .filter((r) => r.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
    )
    const res = await window.api.statsSeries({
      from,
      to,
      source: 'proxy',
      granularity: 'day',
      metric: 'total',
      groupBy: 'model'
    })
    if (seq !== usageSeq.current) return
    if (res.ok && res.data) setTrend(res.data)
  }, [usageRange])

  useEffect(() => {
    void loadActivity()
  }, [loadActivity])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadActivity()
      void loadUsage()
    }, 10_000)
    return () => clearInterval(timer)
  }, [loadActivity, loadUsage])

  // 趋势与占比共用同一套模型配色，按用量从高到低分配
  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    usage.forEach((r, i) => map.set(r.key, COLORS[i % COLORS.length] as string))
    return map
  }, [usage])

  const usageRows: UsageRow[] = useMemo(
    () =>
      usage.map((r) => ({
        key: r.key,
        label: r.label,
        tokens: r.tokens,
        color: colorOf.get(r.key) ?? (COLORS[0] as string)
      })),
    [usage, colorOf]
  )

  const trendSeries: TrendSeries[] = useMemo(() => {
    if (!trend) return []
    const byKey = new Map(trend.series.map((s) => [s.key, s]))
    const ordered = usage.flatMap((u) => {
      const s = byKey.get(u.key)
      return s ? [{ ...s, label: u.label }] : []
    })
    const extra = trend.series.filter((s) => !usage.some((u) => u.key === s.key))
    return [...ordered, ...extra].map((s, i) => ({
      key: s.key,
      label: s.label,
      points: s.points,
      color: colorOf.get(s.key) ?? (COLORS[i % COLORS.length] as string),
      hidden: trendHidden[s.key] === true
    }))
  }, [trend, usage, colorOf, trendHidden])

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

  const exportCsv = async (): Promise<void> => {
    if (!range) {
      notify('先选有效区间')
      return
    }
    const res = await window.api.statsExport({ from: range.from, to: range.to, source: 'proxy' })
    if (res.ok && res.data) notify(`已导出 ${res.data.rows} 行到 ${res.data.path}`, 'ok')
    else if (res.error && res.error !== '已取消') notify(res.error)
  }

  return (
    <div
      className="section analysis-page"
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest('.ana-head')) setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="analysis-body">
        <ActivityHeatmap daily={activity} />

        <div className="card ana-panel">
          <div className="ana-panel-head">
            <h2>每日 Token 趋势图</h2>
            <div className="seg" role="tablist" aria-label="趋势时间范围">
              {(
                [
                  { id: 7 as UsageRange, label: '近 7 日' },
                  { id: 30 as UsageRange, label: '近 30 日' }
                ] as const
              ).map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  aria-selected={usageRange === r.id}
                  className={usageRange === r.id ? 'on' : ''}
                  onClick={() => setUsageRange(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <TrendChart
            buckets={trend?.buckets ?? []}
            series={trendSeries}
            onToggle={(key) => setTrendHidden((h) => ({ ...h, [key]: !h[key] }))}
          />
        </div>

        <div className="card ana-panel">
          <div className="ana-panel-head">
            <h2>模型用量</h2>
          </div>
          <UsageDonut rows={usageRows} />
        </div>

        <div className="card analysis-card">
          <div className="row nowrap ana-head">
            <div className="row nowrap ana-controls">
              <label className="field">
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
                <select value={metric} onChange={(e) => setMetric(e.target.value as StatsMetric)}>
                  {METRICS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as StatsGroup)}>
                  <option value="model">按模型</option>
                  <option value="provider">按供应商</option>
                  <option value="token">按Token</option>
                </select>
              </label>
            </div>
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

        {menu ? (
          <div
            className="ctxmenu"
            style={{ left: Math.min(menu.x, window.innerWidth - 130), top: Math.min(menu.y, window.innerHeight - 100) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              disabled={busy}
              onClick={() => {
                setMenu(null)
                void load()
                void loadActivity()
                void loadUsage()
              }}
            >
              {busy ? '查询中…' : '刷新'}
            </button>
            <button
              onClick={() => {
                setMenu(null)
                void exportCsv()
              }}
            >
              导出 CSV
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
