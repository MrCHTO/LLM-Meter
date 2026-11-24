import { fmtWan } from '../format'

export interface UsageRow {
  key: string
  label: string
  tokens: number
  color: string
}

interface Props {
  rows: UsageRow[]
}

const SIZE = 220
const R = 78
const STROKE = 26
const C = 2 * Math.PI * R
/** 段间留白（像素弧长） */
const GAP = 3

function pctText(v: number): string {
  return `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`
}

/** 模型用量环图：中心合计，右侧占比与 token 明细。 */
export function UsageDonut({ rows }: Props): JSX.Element {
  const total = rows.reduce((a, r) => a + r.tokens, 0)
  const shown = rows.filter((r) => r.tokens > 0)

  let acc = 0
  const segments = shown.map((r) => {
    const frac = total > 0 ? r.tokens / total : 0
    const seg = { ...r, frac, offset: acc }
    acc += frac
    return seg
  })

  return (
    <div className="donut-grid">
      <div className="donut-wrap">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="donut-svg"
          role="img"
          aria-label={`合计 ${fmtWan(total)} tokens`}
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="donut-track" strokeWidth={STROKE} />
          {segments.map((s) => {
            const len = Math.max(0, s.frac * C - (segments.length > 1 ? GAP : 0))
            return (
              <circle
                key={s.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                className="donut-seg"
                stroke={s.color}
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-s.offset * C}
              />
            )
          })}
        </svg>
        <div className="donut-center">
          <b>{fmtWan(total)}</b>
          <span>tokens</span>
        </div>
      </div>

      <div className="donut-list">
        {rows.length === 0 ? <div className="chart-empty">这个区间没有数据</div> : null}
        {rows.map((r) => {
          const frac = total > 0 ? r.tokens / total : 0
          return (
            <div key={r.key} className="donut-row">
              <div className="donut-row-main">
                <div className="donut-name">
                  <i style={{ background: r.color }} />
                  <span title={r.label}>{r.label}</span>
                  <b className="mono">{pctText(frac)}</b>
                </div>
                <div className="donut-tok mono">{fmtWan(r.tokens)} tokens</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
