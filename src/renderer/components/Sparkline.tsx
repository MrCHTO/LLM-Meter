interface Props {
  buckets: number[]
  /** 只取末尾多少个桶 */
  tail?: number
}

const W = 100
const H = 18

/** 每秒一个桶的迷你曲线，空数据是一条压平的底线。 */
export function Sparkline({ buckets, tail = 30 }: Props): JSX.Element {
  const view = buckets.slice(-tail)
  const max = Math.max(1, ...view)
  const step = view.length > 1 ? W / (view.length - 1) : 0

  const points = view.map((value, index) => {
    const x = (index * step).toFixed(2)
    const y = (H - 1 - (value / max) * (H - 3)).toFixed(2)
    return `${x},${y}`
  })
  const empty = view.every((v) => v === 0)
  const line = points.join(' ')
  const area = `0,${H} ${line} ${W},${H}`

  return (
    <svg className={empty ? 'spark spark-empty' : 'spark'} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polygon className="spark-fill" points={area} />
      <polyline className="spark-line" points={line} />
    </svg>
  )
}
