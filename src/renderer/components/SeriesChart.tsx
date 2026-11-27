import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

const DEFAULT_W = 1000
const DEFAULT_H = 260
const PAD = { top: 12, right: 12, bottom: 22, left: 62 }

/** 挑一个好看的刻度步长（1 / 2 / 2.5 / 5 × 10ⁿ），整数指标至少为 1。 */
function niceStep(peak: number, integer: boolean): number {
  const target = peak / 4 || 1
  const mag = 10 ** Math.floor(Math.log10(target))
  const norm = target / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  return integer ? Math.max(1, Math.round(step)) : step
}

/** 多序列时间轴分组柱状图，纯 SVG：自适应 Y 轴、图例隐藏、悬停十字线。 */
export function SeriesChart({ buckets, series, format, timeFormat, integer = false, onToggle }: Props): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  // 量出气泡真实尺寸，贴近边缘时反向钳制，避免裁切或把卡片撑出滚动条
  const tipRef = useRef<HTMLDivElement>(null)
  const [tipSize, setTipSize] = useState({ w: 160, h: 60 })
  useLayoutEffect(() => {
    if (hover === null || !tipRef.current) return
    const { offsetWidth: w, offsetHeight: h } = tipRef.current
    setTipSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
  }, [hover, series])
  // 视口按容器实际像素设置，柱子不会被纵向拉长
  const [box, setBox] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const roRef = useRef<ResizeObserver | null>(null)
  const plotRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width < 50 || r.height < 50) return
      setBox((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1 ? prev : { w: r.width, h: r.height }
      )
    })
    ro.observe(el)
    roRef.current = ro
  }, [])
  useEffect(() => () => roRef.current?.disconnect(), [])
  const W = box.w
  const H = box.h

  const visible = series.filter((s) => !s.hidden)
  const peak = useMemo(() => {
    let max = 0
    for (const s of visible) for (const v of s.points) if (v > max) max = v
    return max > 0 ? max : 1
  }, [visible])

  const n = buckets.length
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const band = plotW / Math.max(1, n)
  const center = (i: number): number => PAD.left + band * (i + 0.5)

  const step = niceStep(peak, integer)
  const axisMax = Math.max(step, Math.ceil(peak / step) * step)
  const base = PAD.top + plotH
  const y = (v: number): number => PAD.top + plotH - (v / axisMax) * plotH

  const ticks: number[] = []
  for (let v = 0; v <= axisMax + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))

  // 同桶内并排，柱宽随桶宽收窄，最少 1px
  const barW = Math.max(1, Math.min(band * 0.72, 56) / Math.max(1, visible.length))

  if (n === 0) {
    return <div className="chart-empty">这个区间没有数据</div>
  }

  const hoverAt = hover === null ? null : Math.min(n - 1, Math.max(0, hover))

  // 气泡贴着悬停桶：水平居中于柱（边缘钳制），垂直贴最高柱上方
  const tipLeftPct = hoverAt === null ? 0 : (center(hoverAt) / W) * 100
  const tipTopRaw =
    hoverAt === null || visible.length === 0 ? base : Math.min(...visible.map((s) => y(s.points[hoverAt] ?? 0)))
  const tipTop = Math.max(6, Math.min(tipTopRaw - 12, base - tipSize.h - 4))
  const tipPad = tipSize.w / 2 + 4

  return (
    <div className="series-wrap">
      <div className="chart-plot" ref={plotRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="series-svg"
          preserveAspectRatio="none"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            const idx = Math.floor((ratio * W - PAD.left) / band)
            setHover(Number.isFinite(idx) ? Math.min(n - 1, Math.max(0, idx)) : null)
          }}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t, i) => (
            <line key={i} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
          ))}

          {visible.map((s, si) =>
            s.points.map((v, i) => {
              // 0 值不画柱，连底线也不留
              if (v === 0) return null
              const h = Math.max(1, base - y(v))
              const gx = center(i) - (barW * visible.length) / 2 + si * barW
              return (
                <rect
                  key={`${s.key}-${i}`}
                  x={gx}
                  y={base - h}
                  width={Math.max(1, barW - 1)}
                  height={h}
                  fill={s.color}
                  className="series-bar"
                />
              )
            })
          )}

          {hoverAt !== null ? (
            <line x1={center(hoverAt)} x2={center(hoverAt)} y1={PAD.top} y2={base} className="crosshair" />
          ) : null}
        </svg>

        {/* 刻度文字放到 HTML 层，SVG 横向拉伸时字不会被压扁 */}
        <div className="axis-labels y-labels">
          {ticks.map((t, i) => (
            <span key={i} className="axis-y" style={{ top: `${(y(t) / H) * 100}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="axis-labels x-labels">
          {buckets.map((b, i) =>
            i % Math.ceil(n / 8) === 0 || i === n - 1 ? (
              <span key={b} className="axis-x" style={{ left: `${(center(i) / W) * 100}%` }}>
                {timeFormat(b)}
              </span>
            ) : null
          )}
        </div>

        {hoverAt !== null ? (
          <div
            ref={tipRef}
            className="series-tip"
            style={{
              left: `clamp(${tipPad}px, ${tipLeftPct}%, calc(100% - ${tipPad}px))`,
              top: `${(tipTop / H) * 100}%`,
              transform: 'translateX(-50%)'
            }}
          >
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
