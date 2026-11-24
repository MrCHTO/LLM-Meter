interface Props {
  buckets: number[]
  /** 只取末尾多少个桶 */
  tail?: number
}

const W = 100
const H = 18

/** Catmull-Rom → 三次贝塞尔，横向平滑，纵向控制点钳在画布内 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const clamp = (v: number): number => Math.min(H, Math.max(0, v))
  let d = `M${points[0]?.x ?? 0},${points[0]?.y ?? H}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    if (!p0 || !p1 || !p2 || !p3) continue
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6)
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6)
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

/** 每秒一个桶的迷你曲线，空数据是一条压平的底线。 */
export function Sparkline({ buckets, tail = 30 }: Props): JSX.Element {
  const view = buckets.slice(-tail)
  const max = Math.max(1, ...view)
  const step = view.length > 1 ? W / (view.length - 1) : 0

  const points = view.map((value, index) => ({
    x: index * step,
    y: H - 1 - (value / max) * (H - 3)
  }))
  const empty = view.every((v) => v === 0)
  const line = smoothPath(points)
  const area = `${line} L${W},${H} L0,${H} Z`

  return (
    <svg
      className={empty ? 'spark spark-empty' : 'spark'}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path className="spark-fill" d={area} />
      <path className="spark-line" d={line} />
    </svg>
  )
}
