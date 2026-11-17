import io

p = r'src/renderer/components/Dashboard.tsx'
s = io.open(p, encoding='utf-8').read()

# 顶部 import：加 StatsRow，去掉 fmtMs
s = s.replace(
    "import type { ConfigView, LiveSnapshot, ModelLive } from '../../shared/types'",
    "import type { ConfigView, LiveSnapshot, ModelLive, StatsRow } from '../../shared/types'",
    1,
)
s = s.replace(
    "import { fmtMoney, fmtMs, fmtPct, fmtTokens } from '../format'",
    "import { fmtMoney, fmtPct, fmtTokens } from '../format'",
    1,
)

# state + 区间拉取 + 取值助手
old_state = """export function Dashboard({ snapshot, config, notify, onChanged, onOpenLogs }: Props): JSX.Element {
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)"""
new_state = """type Range = 'today' | '1h' | '3h'

export function Dashboard({ snapshot, config, notify, onChanged, onOpenLogs }: Props): JSX.Element {
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  /** 监控卡统计区间；非今天走库内区间查询 */
  const [range, setRange] = useState<Range>('today')
  const [rangeRows, setRangeRows] = useState<Map<string, StatsRow> | null>(null)"""
assert old_state in s
s = s.replace(old_state, new_state, 1)

old_effect_anchor = """  useEffect(() => {
    if (!menu) return"""
range_effect = """  // 非「今天」的区间：每 5 秒拉一次按模型的区间合计
  useEffect(() => {
    if (range === 'today') {
      setRangeRows(null)
      return
    }
    let stopped = false
    const load = async (): Promise<void> => {
      const to = Date.now()
      const from = range === '1h' ? to - 3_600_000 : to - 10_800_000
      const res = await window.api.statsTotals({ from, to, source: 'proxy', groupBy: 'model' })
      if (!stopped && res.ok && res.data) setRangeRows(new Map(res.data.map((r) => [r.key, r])))
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [range])

  useEffect(() => {
    if (!menu) return"""
assert old_effect_anchor in s
s = s.replace(old_effect_anchor, range_effect, 1)

# 取值助手：放在 dropOn 之前
anchor_drop = "  const dropOn = async (targetId: string, sourceId: string | null): Promise<void> => {"
helpers = """  const rowOf = (modelId: string): StatsRow | undefined => rangeRows?.get(modelId)
  const tokOf = (
    m: ModelLive
  ): {
    uncached: number
    read: number
    readReported: boolean
    inputReported: boolean
    cacheInput: number
    output: number
    cost: number
  } => {
    const r = range === 'today' ? undefined : rowOf(m.modelId)
    if (!r) {
      return {
        uncached: m.today.uncachedInput,
        read: m.today.cacheRead,
        readReported: m.today.cacheReadReported > 0,
        inputReported: m.today.cacheInputReported > 0,
        cacheInput: m.today.cacheInput,
        output: m.today.output,
        cost: m.today.cost
      }
    }
    return {
      uncached: r.uncached,
      read: r.cacheRead,
      readReported: r.cacheReadReported > 0,
      inputReported: r.cacheInputReported > 0,
      cacheInput: r.cacheInput,
      output: r.output,
      cost: r.cost
    }
  }
  const hitOf = (m: ModelLive): { read: number; input: number; reported: boolean } | null => {
    const r = range === 'today' ? undefined : rowOf(m.modelId)
    if (!r) {
      if (m.hitRate === null) return null
      return { read: m.today.cacheRead, input: m.today.input, reported: true }
    }
    if (r.cacheReadReported > 0 || r.cacheRead > 0) {
      return { read: r.cacheRead, input: r.input, reported: true }
    }
    return null
  }

"""
assert anchor_drop in s
s = s.replace(anchor_drop, helpers + anchor_drop, 1)

# 卡片头：监控标题 + 区间下拉
old_card = """      <div className="card">
        <table className={`tbl tbl-flush${cols.fixed ? ' col-fixed' : ''}`} {...cols.tableProps}>"""
new_card = """      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>监控</h2>
          <select
            className="range-select"
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            title="监控统计区间"
          >
            <option value="today">今天</option>
            <option value="1h">近 1 小时</option>
            <option value="3h">近 3 小时</option>
          </select>
        </div>
        <table className={`tbl tbl-flush${cols.fixed ? ' col-fixed' : ''}`} {...cols.tableProps}>"""
assert old_card in s
s = s.replace(old_card, new_card, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('dashboard head/state done')
