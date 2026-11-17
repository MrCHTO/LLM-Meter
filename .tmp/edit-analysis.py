import io

p = r'src/renderer/components/Analysis.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) 去掉明细表相关 state / 工具
s = s.replace(
    "  const cols = useColumnWidths('analysis-detail', [160, 70, 60, 85, 85, 85, 80, 90, 90, 80, 80, 80, 70, 80])\n",
    "",
    1,
)
s = s.replace("  const [totals, setTotals] = useState<StatsRow[]>([])\n", "", 1)
s = s.replace("  const [busy, setBusy] = useState(false)\n", "  const [busy, setBusy] = useState(false)\n  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)\n", 1)

# 2) load 里不再查 totals
s = s.replace("""      const r = rangeOf(preset, customFrom, customTo)
      if (!r) {
        setSeries(null)
        setTotals([])
        return
      }""",
"""      const r = rangeOf(preset, customFrom, customTo)
      if (!r) {
        setSeries(null)
        return
      }""", 1)
s = s.replace("""        const q = { from: r.from, to: r.to, source: 'proxy' as const }
        const [s, t] = await Promise.all([
          window.api.statsSeries({ ...q, granularity: granularityOf(r.to - r.from), metric, groupBy }),
          window.api.statsTotals({ ...q, groupBy })
        ])
        if (s.ok && s.data) setSeries(s.data)
        else if (!silent) notify(s.error ?? '查询失败')
        if (t.ok && t.data) setTotals(t.data)""",
"""        const q = { from: r.from, to: r.to, source: 'proxy' as const }
        const s = await window.api.statsSeries({ ...q, granularity: granularityOf(r.to - r.from), metric, groupBy })
        if (s.ok && s.data) setSeries(s.data)
        else if (!silent) notify(s.error ?? '查询失败')""", 1)

# 3) 菜单关闭 effect（放在轮询 effect 后）
anchor = """  useEffect(() => {
    if (preset !== 'custom') return
    const timer = setInterval(() => void load(true), 5000)"""
# 直接在第一个轮询 effect 结束后追加较稳：找到其 return 段
ret = """    return () => clearInterval(timer)
  }, [load, preset])"""
menu_effect = ret + """

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])"""
assert ret in s
s = s.replace(ret, menu_effect, 1)

# 4) 删除 top/totalOf 助手
s = s.replace("""  const totalOf = (pick: (r: StatsRow) => number): number => totals.reduce((a, r) => a + pick(r), 0)
  const top = useMemo(() => [...totals].sort((a, b) => b.cost - a.cost).slice(0, 10), [totals])

""", "", 1)

# 5) 卡头：去掉区间合计与两个按钮；卡片加 class 与右键
s = s.replace("""      <div className="card">
        <div className="row nowrap ana-head">""",
"""      <section
        className="section analysis-page"
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest('.ana-head')) setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
      <div className="card analysis-card">
        <div className="row nowrap ana-head">""", 1)
s = s.replace("""            <span className="muted ana-sum">
              区间合计 {fmt(totalOf((r) => (metric === 'cost' ? r.cost : metric === 'tps' ? (r.tps ?? 0) : metric === 'total' ? r.total : (r[metric === 'cache_read' ? 'cacheRead' : metric] as number))))} {meta.unit}
            </span>
            <button className="btn" disabled={busy} onClick={() => void load()}>
              {busy ? '查询中' : '刷新'}
            </button>
            <button className="btn" onClick={() => void exportCsv()}>
              导出 CSV
            </button>
          </div>""",
"""          </div>""", 1)

# 6) 删掉整个明细表卡，并把外层改为 section 收尾
old_tail = """      <div className="card">
        <table className={`tbl tbl-detail${cols.fixed ? ' col-fixed' : ''}`} {...cols.tableProps}>
          {cols.colgroup}
          <thead>
            <tr>
              <th className="c-model">{groupBy === 'model' ? '模型' : groupBy === 'provider' ? '供应商' : 'Token'}{cols.resizer(0)}</th>
              <th>请求{cols.resizer(1)}</th>
              <th>错误{cols.resizer(2)}</th>
              <th>未缓存输入{cols.resizer(3)}</th>
              <th>缓存读取{cols.resizer(4)}</th>
              <th>缓存输入{cols.resizer(5)}</th>
              <th>输出{cols.resizer(6)}</th>
              <th>总输入{cols.resizer(7)}</th>
              <th>总 token{cols.resizer(8)}</th>
              <th>TTFT P50{cols.resizer(9)}</th>
              <th>TTFT P95{cols.resizer(10)}</th>
              <th>TTFT P99{cols.resizer(11)}</th>
              <th>tok/s{cols.resizer(12)}</th>
              <th>成本{cols.resizer(13)}</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.key}>
                <td className="c-model">{r.label}</td>
                <td className="mono">{fmtTokens(r.requests)}</td>
                <td className="mono">{r.errors || '—'}</td>
                <td className="mono">{fmtTokens(r.uncached)}</td>
                <td className="mono">{r.cacheReadReported > 0 ? fmtTokens(r.cacheRead) : '—'}</td>
                <td className="mono">{r.cacheInputReported > 0 ? fmtTokens(r.cacheInput) : '—'}</td>
                <td className="mono">{fmtTokens(r.output)}</td>
                <td className="mono">{fmtTokens(r.input)}</td>
                <td className="mono">{fmtTokens(r.total)}</td>
                <td className="mono">{fmtMs(r.ttftP50)}</td>
                <td className="mono">{fmtMs(r.ttftP95)}</td>
                <td className="mono">{fmtMs(r.ttftP99)}</td>
                <td className="mono">{r.tps === null ? '—' : r.tps.toFixed(1)}</td>
                <td className="mono">{fmtMoney(r.cost)}</td>
              </tr>
            ))}
            {totals.length === 0 ? (
              <tr>
                <td colSpan={14} className="empty">
                  {range ? '这个区间没有数据' : '选一个合法区间'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <span className="muted">按成本取前 10；共 {totals.length} 组</span>
      </div>
    </div>
  )
}"""
assert old_tail in s
s = s.replace(old_tail, """      {menu ? (
        <div
          className="ctxmenu"
          style={{ left: Math.min(menu.x, window.innerWidth - 130), top: Math.min(menu.y, window.innerHeight - 100) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setMenu(null)
              void load()
            }}
          >
            刷新
          </button>
          <button
            onClick={() => {
              setMenu(null)
              void exportCsv()
            }}
          >
            导出 CSV
          </button>
        </div>
      ) : null}
      </section>
    </div>
  )
}""", 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('analysis done')
