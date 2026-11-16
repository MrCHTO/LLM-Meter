import type { ModelLive } from '../../shared/types'

/** 按顺序取色相：黄金角错开，低饱和；同表内相邻颜色区分明显 */
export function rateColor(index: number): string {
  const hue = Math.round((index * 137.5) % 360)
  return `${hue} 52% 42%`
}

interface Series {
  color: string
  buckets: number[]
}

interface Props {
  /** 每条曲线一组；每秒一根无缝柱，柱内按各系列数值分段堆叠上色 */
  series: Series[]
  /** 柱段的 class 名（rate-bar / req-bar），供样式与用例取用 */
  barClass: string
}

const W = 600
const H = 100

/** 最近 60 秒的柱状波形：一秒一柱、相邻无缝，多模型在柱内分段堆叠（总高=合计） */
export function DenseBars({ series, barClass }: Props): JSX.Element {
  const count = Math.max(1, ...series.map((s) => s.buckets.length))
  const slot = W / count
  // 归一化用「每秒合计」的峰值，保证堆叠后总高度可比
  const totalAt = (i: number): number => series.reduce((a, s) => a + (s.buckets[i] ?? 0), 0)
  const peak = Math.max(1, ...Array.from({ length: count }, (_, i) => totalAt(i)))
  const fallback = series[0]?.color ?? 'var(--bar-track)'

  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const total = totalAt(i)
        if (total <= 0) {
          // 空闲秒：每条系列留一条 0.6 的细底线，保持多色与密集观感
          const lanes = Math.max(1, series.length)
          const sliver = 0.6 / lanes
          return (
            <g key={`z-${i}`}>
              {series.map((s, si) => (
                <rect
                  key={si}
                  className={barClass}
                  x={(i * slot).toFixed(2)}
                  y={(H - sliver * (si + 1)).toFixed(2)}
                  width={slot.toFixed(2)}
                  height={sliver.toFixed(2)}
                  fill={s.color ?? fallback}
                />
              ))}
            </g>
          )
        }
        const barHeight = Math.max(0.6, (total / peak) * (H - 1))
        const unit = barHeight / total
        let cursor = H
        const segments = series.map((s, si) => {
          const value = s.buckets[i] ?? 0
          if (value <= 0) return null
          const height = value * unit
          cursor -= height
          return <rect key={`${si}-${i}`} className={barClass} x={(i * slot).toFixed(2)} y={cursor.toFixed(2)} width={slot.toFixed(2)} height={height.toFixed(2)} fill={s.color} />
        })
        return <g key={i}>{segments}</g>
      })}
    </svg>
  )
}

/** 多模型用的配色解析：颜色表来自完整模型列表，隐藏后不换色 */
export function rateSeries(
  models: ModelLive[],
  colors: Record<string, string>
): { color: string; buckets: number[] }[] {
  return models.map((m) => ({
    color: `hsl(${colors[m.modelId] ?? '210 52% 42%'})`,
    buckets: m.deltaBuckets
  }))
}
