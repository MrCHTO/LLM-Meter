import type { ModelLive } from '../../shared/types'

/** 按顺序取色相：黄金角错开，低饱和；同表内相邻颜色区分明显 */
export function rateColor(index: number): string {
  const hue = Math.round((index * 137.5) % 360)
  return `${hue} 52% 42%`
}

interface Props {
  models: ModelLive[]
  /** 模型 id → HSL 三段值（颜色在完整模型列表里固定，不受隐藏影响） */
  colors: Record<string, string>
}

/** 与请求量曲线同一套 Catmull-Rom 平滑，控制点钳在画布内 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const clamp = (v: number): number => Math.min(height, Math.max(0, v))
  let d = `M${points[0]?.x ?? 0},${points[0]?.y ?? height}`
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

const height = 20

/** 多模型增量速率叠加图：同轴、各自配色，圆滑折线 + 半透明面积 */
export function MultiRate({ models, colors }: Props): JSX.Element {
  const peak = Math.max(1, ...models.flatMap((m) => m.deltaBuckets))
  // 画布宽度跟桶数走（窗口可调，写死会把后面的桶画到可视区外）
  const width = Math.max(1, ...models.map((m) => m.deltaBuckets.length), 1)

  return (
    <div className="multi-rate">
      <svg className="multi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {models.map((m) => {
          const color = `hsl(${colors[m.modelId] ?? '210 52% 42%'})`
          const points = m.deltaBuckets.map((v, i) => ({
            x: i,
            y: height - 1 - (v / peak) * (height - 2)
          }))
          const line = smoothPath(points)
          return (
            <g key={m.modelId}>
              <path className="multi-area" d={`${line} L${width},${height} L0,${height} Z`} fill={color} />
              <path className="multi-line" d={line} stroke={color} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
