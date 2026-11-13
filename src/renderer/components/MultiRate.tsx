import type { ModelLive } from '../../shared/types'

const PALETTE = ['#1f6feb', '#0f9d63', '#c26b1b', '#8a4bd8', '#d34a7a', '#0f8fa3', '#7b8b3a', '#b0392f']

export function colorOf(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length] as string
}

interface Props {
  models: ModelLive[]
}

/** 多模型增量速率叠加图：同轴、各自配色，折线 + 半透明面积；图例只做标注 */
export function MultiRate({ models }: Props): JSX.Element {
  const width = 60
  const height = 20
  const peak = Math.max(1, ...models.flatMap((m) => m.deltaBuckets))

  return (
    <div className="multi-rate">
      <svg className="multi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {models.map((m) => {
          const color = colorOf(m.modelId)
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
      <div className="multi-legend">
        {models.map((m) => (
          <span key={m.modelId} title={m.alias}>
            <i style={{ background: colorOf(m.modelId) }} />
          </span>
        ))}
      </div>
    </div>
  )
}
