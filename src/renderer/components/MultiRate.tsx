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

/** 多模型增量速率叠加图：同轴、各自配色，折线 + 半透明面积；图例只做标注 */
export function MultiRate({ models, colors }: Props): JSX.Element {
  const width = 60
  const height = 20
  const peak = Math.max(1, ...models.flatMap((m) => m.deltaBuckets))

  return (
    <div className="multi-rate">
      <svg className="multi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {models.map((m) => {
          const color = `hsl(${colors[m.modelId] ?? '210 52% 42%'})`
          const points = m.deltaBuckets.map((v, i) => `${i},${height - (v / peak) * (height - 2) - 1}`)
          return (
            <g key={m.modelId}>
              <polygon
                className="multi-area"
                points={`0,${height} ${points.join(' ')} ${width},${height}`}
                fill={color}
              />
              <polyline className="multi-line" points={points.join(' ')} stroke={color} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
