interface Props {
  buckets: number[]
  hot?: boolean
  /** 只画末尾多少个桶 */
  tail?: number
}

/** 每秒一个桶的迷你柱状图。 */
export function Sparkline({ buckets, hot, tail = 60 }: Props): JSX.Element {
  const view = buckets.slice(-tail)
  const max = Math.max(1, ...view)
  return (
    <span className="bar" title={`最近峰值 ${max}`}>
      {view.map((value, index) => {
        const height = value > 0 ? Math.max(2, Math.round((value / max) * 20)) : 1
        const isHot = hot ?? index >= view.length - 10
        return (
          <i
            key={index}
            className={isHot && value > 0 ? 'hot' : undefined}
            style={{ height: `${height}px`, opacity: value > 0 ? 1 : 0.35 }}
          />
        )
      })}
    </span>
  )
}
