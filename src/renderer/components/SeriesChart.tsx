import { useMemo, useState } from 'react'
import '../analysis.css'

export interface SeriesItem {
  key: string
  label: string
  points: number[]
  color: string
  hidden?: boolean
}

interface Props {
  buckets: number[]
  series: SeriesItem[]
  /** 数值格式化，用于轴与提示 */
  format: (v: number) => string
  /** 时间轴格式化 */
  timeFormat: (ts: number) => string
  /** 计数类指标：刻度取整，避免 0.75 被格式化后重复 */
  integer?: boolean
  onToggle: (key: string) => void
}

const W = 1000
const H = 260
const PAD = { top: 12, right: 12, bottom: 22, left: 62 }

/** 挑一个好看的刻度步长（1 / 2 / 2.5 / 5 × 10ⁿ），整数指标至少为 1。 */
function niceStep(peak: number, integer: boolean): number {
  const target = peak / 4 || 1
  const mag = 10 ** Math.floor(Math.log10(target))
  const norm = target / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  return integer ? Math.max(1, Math.round(step)) : step
}

/** 多序列时间轴折线，纯 SVG：自适应 Y 轴、图例隐藏、悬停十字线。 */
export function SeriesChart({ buckets, series, format, timeFormat, integer = false, onToggle }: Props): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)

  const visible = series.filter((s) => !s.hidden)
  const peak = useMemo(() => {
    let max = 0
    for (const s of visible) for (const v of s.points) if (v > max) max = v
    return max > 0 ? max : 1
  }, [visible])

  const n = buckets.length
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number): number => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)

  const step = niceStep(peak, integer)
  const axisMax = Math.max(step, Math.ceil(peak / step) * step)
  const y = (v: number): number => PAD.top + plotH - (v / axisMax) * plotH

  const ticks: number[] = []
  for (let v = 0; v <= axisMax + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))

  if (n === 0) {
    return <div className="chart-empty">这个区间没有数据</div>
  }

  const hoverAt = hover === null ? null : Math.min(n - 1, Math.max(0, hover))

  return (
    <div className="series-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="series-svg"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          const idx = Math.round(ratio * W - PAD.left) / (plotW / Math.max(1, n - 1))
          setHover(Number.isFinite(idx) ? Math.round(idx) : null)
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="axis">
              {format(t)}
            </text>
          </g>
        ))}

        {buckets.map((b, i) =>
          i % Math.ceil(n / 8) === 0 || i === n - 1 ? (
            <text key={b} x={x(i)} y={H - 6} textAnchor="middle" className="axis">
              {timeFormat(b)}
            </text>
          ) : null
        )}

        {visible.map((s) => (
          <polyline
            key={s.key}
            className="series-line"
            stroke={s.color}
            points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}

        {/* 点少时补点，避免单点或双点画不出形状 */}
        {n <= 60
          ? visible.map((s) =>
              s.points.map((v, i) => (
                <circle key={`${s.key}-${i}`} r={2.6} cx={x(i)} cy={y(v)} fill={s.color} />
              ))
            )
          : null}

        {hoverAt !== null ? (
          <line x1={x(hoverAt)} x2={x(hoverAt)} y1={PAD.top} y2={H - PAD.bottom} className="crosshair" />
        ) : null}
      </svg>

      {hoverAt !== null ? (
        <div className="series-tip">
          <div className="tip-time">{timeFormat(buckets[hoverAt] as number)}</div>
          {visible.map((s) => (
            <div key={s.key} className="tip-row">
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <b className="mono">{format(s.points[hoverAt] ?? 0)}</b>
            </div>
          ))}
        </div>
      ) : null}

      <div className="legend">
        {series.map((s) => (
          <button
            key={s.key}
            className={s.hidden ? 'legend-item off' : 'legend-item'}
            onClick={() => onToggle(s.key)}
          >
            <i style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
