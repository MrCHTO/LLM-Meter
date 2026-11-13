import type { ModelLive } from '../../shared/types'

const PALETTE = ['#1f6feb', '#0f9d63', '#c26b1b', '#8a4bd8', '#d34a7a', '#0f8fa3', '#7b8b3a', '#b0392f']

export function colorOf(index: number): string {
  return PALETTE[index % PALETTE.length] as string
}

interface Props {
  models: ModelLive[]
  hidden: Record<string, boolean>
  onToggle: (id: string) => void
}

/** 多模型增量速率叠加图：同轴、各自配色，折线 + 半透明面积 */
export function MultiRate({ models, hidden, onToggle }: Props): JSX.Element {
  const width = 60
  const height = 20
  const visible = models.filter((m) => !hidden[m.modelId])
  const peak = Math.max(1, ...visible.flatMap((m) => m.deltaBuckets))

  return (
    <div className="multi-rate">
      <div className="multi-legend">
        {models.map((m, i) => {
          const off = hidden[m.modelId] === true
          return (
            <button
              key={m.modelId}
              className={off ? 'off' : ''}
              title={off ? '点击显示' : '点击隐藏'}
              onClick={() => onToggle(m.modelId)}
            >
              <i style={{ background: colorOf(i) }} />
              {m.alias}
            </button>
          )
        })}
      </div>
      <svg className="multi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {visible.map((m) => {
          const color = colorOf(models.indexOf(m))
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
