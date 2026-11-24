import { useMemo, useState } from 'react'
import { fmtWan } from '../../shared/format'
import { dateKey } from '../../shared/date'

export type ActivityMode = 'day' | 'week' | 'total'

interface Props {
  /** 日键（YYYY-MM-DD）→ 当日 token */
  daily: Map<string, number>
}

/** 近一年 53 周，列为一周、行为周日到周六 */
const WEEKS = 53
const DAY_MS = 86_400_000

function monthLabel(d: Date): string {
  return `${d.getMonth() + 1}月`
}

interface Cell {
  ts: number
  key: string
  col: number
  row: number
}

/** GitHub 式年度活动格：按日 / 按周 / 累计三种口径着色，悬停出读数。 */
export function ActivityHeatmap({ daily }: Props): JSX.Element {
  const [mode, setMode] = useState<ActivityMode>('day')
  const [hover, setHover] = useState<{ col: number; row: number } | null>(null)

  const days = useMemo<Cell[]>(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today.getTime() - (WEEKS * 7 - 1) * DAY_MS)
    start.setDate(start.getDate() - start.getDay())
    const out: Cell[] = []
    for (let i = 0; ; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      if (d.getTime() > today.getTime()) break
      out.push({ ts: d.getTime(), key: dateKey(d), col: Math.floor(i / 7), row: d.getDay() })
    }
    return out
  }, [])

  const cols = (days[days.length - 1]?.col ?? 0) + 1

  // 每周合计与累计：模式切换只换读数口径，格子网格不变
  const values = useMemo(() => {
    const week = new Map<number, number>()
    for (const c of days) week.set(c.col, (week.get(c.col) ?? 0) + (daily.get(c.key) ?? 0))
    const out = new Map<string, number>()
    let run = 0
    for (const c of days) {
      const own = daily.get(c.key) ?? 0
      run += own
      out.set(c.key, mode === 'day' ? own : mode === 'week' ? (week.get(c.col) ?? 0) : run)
    }
    return out
  }, [days, daily, mode])

  const max = useMemo(() => {
    let m = 0
    for (const v of values.values()) if (v > m) m = v
    return m
  }, [values])

  // 有值即至少 1 级，按峰值四等分升档
  const levelOf = (v: number): number => {
    if (v <= 0) return 0
    if (max <= 0) return 1
    return Math.min(5, 1 + Math.floor((v / max) * 4.999))
  }

  const monthCols = useMemo(() => {
    const marks: { col: number; label: string }[] = []
    for (const c of days) {
      const d = new Date(c.ts)
      if (d.getDate() !== 1) continue
      if (marks[marks.length - 1]?.col === c.col) continue
      marks.push({ col: c.col, label: monthLabel(d) })
    }
    return marks
  }, [days])

  const hovered = hover
    ? days.find((c) => c.col === hover.col && c.row === hover.row && values.get(c.key) !== undefined)
    : null
  const hoverValue = hovered ? (values.get(hovered.key) ?? 0) : 0
  const weekStart = hovered ? new Date(days.find((c) => c.col === hovered.col)?.ts ?? hovered.ts) : null
  const weekEnd = weekStart ? new Date(weekStart.getTime() + 6 * DAY_MS) : null

  let total = 0
  for (const v of daily.values()) total += v

  return (
    <div className="card ana-panel">
      <div className="ana-panel-head">
        <h2>Token 活动</h2>
        <div className="seg" role="tablist" aria-label="Token 活动口径">
          {(
            [
              { id: 'day', label: '每日' },
              { id: 'week', label: '每周' },
              { id: 'total', label: '累计' }
            ] as { id: ActivityMode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? 'on' : ''}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="heat-wrap" onMouseLeave={() => setHover(null)}>
        <div
          className="heat-grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          role="img"
          aria-label={`近一年 Token 活动，共 ${fmtWan(total)} tokens`}
        >
          {days.map((c) => {
            const v = values.get(c.key) ?? 0
            const on = hover?.col === c.col && hover?.row === c.row
            return (
              <div
                key={c.key}
                className={on ? 'heat-cell on' : 'heat-cell'}
                data-lv={levelOf(v)}
                onMouseEnter={() => setHover({ col: c.col, row: c.row })}
              />
            )
          })}
        </div>

        {hovered ? (
          <div
            className="heat-tip"
            style={{ left: `clamp(72px, ${((hovered.col + 0.5) / cols) * 100}%, calc(100% - 72px))` }}
          >
            <div className="tip-time">
              {mode === 'week' && weekStart && weekEnd && hovered
                ? `${dateKey(weekStart)} – ${dateKey(weekEnd)}`
                : hovered.key}
            </div>
            <div className="tip-row">
              <b className="mono">{fmtWan(hoverValue)} tokens</b>
            </div>
          </div>
        ) : null}

        <div className="heat-months" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, col) => (
            <span key={col} style={{ gridColumn: col + 1 }}>
              {monthCols.find((m) => m.col === col)?.label ?? ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
