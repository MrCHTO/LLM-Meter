import { useState } from 'react'
import { fmtWan } from '../format'

export interface TrendSeries {
  key: string
  label: string
  points: number[]
  color: string
  hidden?: boolean
}

interface Props {
  buckets: number[]
  series: TrendSeries[]
  onToggle: (key: string) => void
}

const W = 1000
const H = 240
const PAD = { top: 14, right: 30, bottom: 24, left: 30 }

function dayLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** Catmull-Rom 转三次贝塞尔，折点处收成圆滑过渡；控制点纵向钳在绘图区内防过冲 */
function smoothPath(pts: [number, number][], top: number, bottom: number): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0]?.[0]} ${pts[0]?.[1]}`
  const clamp = (v: number): number => Math.max(top, Math.min(bottom, v))
  const at = (i: number): [number, number] => pts[Math.max(0, Math.min(pts.length - 1, i))] as [number, number]
  let d = `M ${pts[0]?.[0]} ${pts[0]?.[1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i) as [number, number]
    const p2 = at(i + 1) as [number, number]
    const p3 = at(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6)
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6)
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`
  }
  return d
}

/** 每日 token 折线图：Y 轴只留网格，悬停十字线读数。 */
export function TrendChart({ buckets, series, onToggle }: Props): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)

  const visible = series.filter((s) => !s.hidden)
  const n = buckets.length
  if (n === 0) return <div className="chart-empty">这个区间没有数据</div>

  let peak = 0
  for (const s of visible) for (const v of s.points) if (v > peak) peak = v
  const axisMax = Math.max(1, peak * 1.15)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const base = PAD.top + plotH
  const x = (i: number): number => PAD.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1))
  const y = (v: number): number => base - (v / axisMax) * plotH

  const labelEvery = Math.max(1, Math.ceil(n / 7))
  const hoverAt = hover === null ? null : Math.min(n - 1, Math.max(0, hover))
  const tipLeft = hoverAt === null ? 0 : x(hoverAt)
  const tipTop =
    hoverAt === null || visible.length === 0
      ? base
      : Math.min(...visible.map((s) => y(s.points[hoverAt] ?? 0)))

  return (
    <div className="trend-wrap">
      <div className="chart-plot">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend-svg"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          setHover(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))))
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + (plotH * i) / 4}
            y2={PAD.top + (plotH * i) / 4}
            className="trend-grid"
          />
        ))}

        {visible.map((s) => (
          <path
            key={s.key}
            className="trend-line"
            stroke={s.color}
            d={smoothPath(
              s.points.map((v, i) => [x(i), y(v)]),
              PAD.top,
              base
            )}
          />
        ))}

        {hoverAt !== null ? (
          <line x1={x(hoverAt)} x2={x(hoverAt)} y1={PAD.top} y2={base} className="crosshair" />
        ) : null}
      </svg>

      {/* 时间刻度用 HTML 层，避免随 SVG 横向拉伸变形 */}
      <div className="axis-labels x-labels">
        {buckets.map((b, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <span
              key={b}
              className="axis-x"
              style={{ left: `${(x(i) / W) * 100}%` }}
            >
              {dayLabel(b)}
            </span>
          ) : null
        )}
      </div>

      {hoverAt !== null ? (
        <div
          className="series-tip"
          style={{
            left: `clamp(80px, ${(tipLeft / W) * 100}%, calc(100% - 80px))`,
            top: `${(Math.max(6, Math.min(tipTop - 12, 160)) / H) * 100}%`,
            transform: 'translateX(-50%)'
          }}
        >
          <div className="tip-time">{dayLabel(buckets[hoverAt] as number)}</div>
          {visible.map((s) => (
            <div key={s.key} className="tip-row">
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <b className="mono">{fmtWan(s.points[hoverAt] ?? 0)}</b>
            </div>
          ))}
        </div>
      ) : null}
      </div>

      <div className="legend">
        {series.map((s) => (
          <button key={s.key} className={s.hidden ? 'legend-item off' : 'legend-item'} onClick={() => onToggle(s.key)}>
            <i style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
