import type { ModelLive } from '../../shared/types'
import { smoothPath } from '../lib/path'

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
          const line = smoothPath(points, { min: 0, max: height })
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
