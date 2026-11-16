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
  /** 每条曲线一组；每秒同一槽位内各系列并排细柱，不叠加 */
  series: Series[]
  /** 柱子的 class 名（rate-bar / req-bar），供样式与用例取用 */
  barClass: string
}

const W = 600
const H = 100
const GAP = 1

/** 最近 60 秒的密集柱状图：一柱一秒，多模型并排、颜色区分 */
export function DenseBars({ series, barClass }: Props): JSX.Element {
  const count = Math.max(1, ...series.map((s) => s.buckets.length))
  const peak = Math.max(1, ...series.flatMap((s) => s.buckets))
  const slot = W / count
  const lanes = Math.max(1, series.length)
  const barWidth = Math.max(0.5, slot / lanes - GAP)

  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
      {series.map((s, si) =>
        s.buckets.map((value, i) => {
          const height = value > 0 ? Math.max(0.6, (value / peak) * (H - 1)) : 0.6
          const x = i * slot + si * (slot / lanes) + GAP / 2
          return (
            <rect
              key={`${si}-${i}`}
              className={barClass}
              x={x.toFixed(2)}
              y={(H - height).toFixed(2)}
              width={barWidth.toFixed(2)}
              height={height.toFixed(2)}
              fill={s.color}
            />
          )
        })
      )}
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
