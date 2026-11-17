import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigView, StatsGranularity, StatsGroup, StatsMetric, StatsSeries } from '../../shared/types'
import { fmtMoney, fmtTokens } from '../format'
import { SeriesChart, type SeriesItem } from './SeriesChart'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
}

type Preset = 'today' | '24h' | '7d' | 'custom'

const METRICS: { id: StatsMetric; label: string; unit: string; digits: number }[] = [
  { id: 'requests', label: '请求数', unit: '次', digits: 0 },
  { id: 'total', label: '总 token', unit: '个', digits: 0 },
  { id: 'input', label: '总输入 token', unit: '个', digits: 0 },
  { id: 'uncached', label: '未缓存输入 token', unit: '个', digits: 0 },
  { id: 'output', label: '输出 token', unit: '个', digits: 0 },
  { id: 'cost', label: '成本', unit: '¥', digits: 2 }
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
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [series, setSeries] = useState<StatsSeries | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
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
      <div className="card analysis-card">
        <div className="row nowrap ana-head">
          <div className="row nowrap ana-controls">
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
            onClick={() => {
              setMenu(null)
              void load()
            }}
          >
            刷新
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
