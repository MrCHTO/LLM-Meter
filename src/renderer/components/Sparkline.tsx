import { smoothPath } from '../lib/path'

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

  const points = view.map((value, index) => ({
    x: index * step,
    y: H - 1 - (value / max) * (H - 3)
  }))
  const empty = view.every((v) => v === 0)
  const line = smoothPath(points, { min: 0, max: H })
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
