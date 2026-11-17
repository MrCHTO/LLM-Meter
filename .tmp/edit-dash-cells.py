import io

p = r'src/renderer/components/Dashboard.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) 列宽默认：13 → 10
s = s.replace(
    "  const cols = useColumnWidths('dashboard', [200, 120, 95, 70, 70, 70, 100, 80, 80, 80, 80, 90, 34])",
    "  const cols = useColumnWidths('dashboard', [200, 120, 60, 100, 80, 80, 80, 80, 90, 34])",
    1,
)

# 2) 表头：删 TTFT 三列
s = s.replace(
    """              <th className="c-rate">TPS{cols.resizer(2)}</th>
              <th className="c-ttft">TTFT P50{cols.resizer(3)}</th>
              <th className="c-ttft">TTFT P95{cols.resizer(4)}</th>
              <th className="c-ttft">TTFT P99{cols.resizer(5)}</th>
              <th className="c-hit"><span className="hd-cache">缓存</span>命中率{cols.resizer(6)}</th>
              <th className="c-tok">未缓存输入{cols.resizer(7)}</th>
              <th className="c-tok">缓存读取{cols.resizer(8)}</th>
              <th className="c-tok">缓存输入{cols.resizer(9)}</th>
              <th className="c-tok">输出{cols.resizer(10)}</th>
              <th className="c-cost">费用{cols.resizer(11)}</th>
              <th className="c-drag">{cols.resizer(12)}</th>""",
    """              <th className="c-rate">TPS{cols.resizer(2)}</th>
              <th className="c-hit"><span className="hd-cache">缓存</span>命中率{cols.resizer(3)}</th>
              <th className="c-tok">未缓存输入{cols.resizer(4)}</th>
              <th className="c-tok">缓存读取{cols.resizer(5)}</th>
              <th className="c-tok">缓存输入{cols.resizer(6)}</th>
              <th className="c-tok">输出{cols.resizer(7)}</th>
              <th className="c-cost">费用{cols.resizer(8)}</th>
              <th className="c-drag">{cols.resizer(9)}</th>""",
    1,
)

# 3) 行单元格：删 TTFT 三个 td，数据源按区间切换
s = s.replace(
    """                    <td className="c-rate mono">{m.lastTps === null ? '—' : Math.round(m.lastTps)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP50)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP95)}</td>
                    <td className="c-ttft mono">{fmtMs(m.ttftP99)}</td>
                    <td
                      className="c-hit mono"
                      title={m.today.cacheReadReported > 0 ? `缓存读取 ${fmtTokens(m.today.cacheRead)} / 输入 ${fmtTokens(m.today.input)}` : '渠道未上报缓存读计数'}
                    >
                      {fmtPct(m.hitRate)}
                    </td>
                    <td className="c-tok mono">{fmtTokens(m.today.uncachedInput)}</td>
                    <td className="c-tok mono">{m.today.cacheReadReported > 0 ? fmtTokens(m.today.cacheRead) : '—'}</td>
                    <td className="c-tok mono">{m.today.cacheInputReported > 0 ? fmtTokens(m.today.cacheInput) : '—'}</td>
                    <td className="c-tok mono">{fmtTokens(m.today.output)}</td>
                    <td className="c-cost mono">{fmtMoney(m.today.cost, m.currency)}</td>""",
    """                    <td className="c-rate mono">
                      {range === 'today'
                        ? m.lastTps === null ? '—' : Math.round(m.lastTps)
                        : (rowOf(m.modelId)?.tps ?? null) === null ? '—' : Math.round(rowOf(m.modelId)!.tps as number)}
                    </td>
                    <td
                      className="c-hit mono"
                      title={hitOf(m)?.reported ? `缓存读取 ${fmtTokens(hitOf(m)!.read)} / 输入 ${fmtTokens(hitOf(m)!.input)}` : '渠道未上报缓存读计数'}
                    >
                      {hitOf(m)?.reported ? fmtPct(hitOf(m)!.read / hitOf(m)!.input) : '—'}
                    </td>
                    <td className="c-tok mono">{fmtTokens(tokOf(m).uncached)}</td>
                    <td className="c-tok mono">{tokOf(m).readReported ? fmtTokens(tokOf(m).read) : '—'}</td>
                    <td className="c-tok mono">{tokOf(m).inputReported ? fmtTokens(tokOf(m).cacheInput) : '—'}</td>
                    <td className="c-tok mono">{fmtTokens(tokOf(m).output)}</td>
                    <td className="c-cost mono">{fmtMoney(tokOf(m).cost, m.currency)}</td>""",
    1,
)

# 4) colSpan 13 → 10
s = s.replace('<td colSpan={13} className="empty">', '<td colSpan={10} className="empty">', 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('dashboard table cells done')
