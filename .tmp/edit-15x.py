import io

# ---------- 1. Dashboard 区间扩展 ----------
p = r'src/renderer/components/Dashboard.tsx'
s = io.open(p, encoding='utf-8').read()
s = s.replace("type Range = 'today' | '1h' | '3h'", "type Range = 'today' | '24h' | 'week' | 'month'", 1)
s = s.replace("""    let stopped = false
    const load = async (): Promise<void> => {
      const to = Date.now()
      const from = range === '1h' ? to - 3_600_000 : to - 10_800_000""",
"""    let stopped = false
    const fromOf = (to: number): number => {
      if (range === '24h') return to - 86_400_000
      if (range === 'week') {
        const d = new Date(to)
        const day = (d.getDay() + 6) % 7 // 周一为 0
        d.setDate(d.getDate() - day)
        d.setHours(0, 0, 0, 0)
        return d.getTime()
      }
      // month
      const d = new Date(to)
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    const load = async (): Promise<void> => {
      const to = Date.now()
      const from = fromOf(to)""", 1)
s = s.replace("""            <option value="today">今天</option>
            <option value="1h">近 1 小时</option>
            <option value="3h">近 3 小时</option>""",
"""            <option value="today">今天</option>
            <option value="24h">近 24 小时</option>
            <option value="week">本周</option>
            <option value="month">本月</option>""", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------- 2. 拖拽列防挤压 ----------
p = r'src/renderer/styles.css'
s = io.open(p, encoding='utf-8').read()
s = s.replace(""".grip {
  display: inline-block;""",
""".c-drag {
  width: 30px;
  min-width: 30px;
}

.grip {
  padding: 0 5px;
  display: inline-block;""", 1)

# ---------- 4. 接入右列顶部空档 ----------
s = s.replace(""".access-cols-right {
  flex: 1;
  min-width: 0;
  border-left: 1px solid var(--line);
  padding-left: 16px;
  padding-top: 12px;
}""",
""".access-cols-right {
  flex: 1;
  min-width: 0;
  border-left: 1px solid var(--line);
  padding-left: 16px;
  align-self: center;
}""", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------- 3. 分析页删标签 ----------
p = r'src/renderer/components/Analysis.tsx'
s = io.open(p, encoding='utf-8').read()
for label, sel in [
    ('时间范围', '<select value={preset}'),
    ('指标', '<select value={metric}'),
    ('分组', '<select value={groupBy}'),
]:
    s = s.replace(f"              <span>{label}</span>\n", "", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------- 4b. 日志页删标签 ----------
p = r'src/renderer/components/Logs.tsx'
s = io.open(p, encoding='utf-8').read()
for label in ['时间范围', '模型', '来源', '结果', '级别', '关键字']:
    s = s.replace(f"<span>{label}</span>\n", "")
    s = s.replace(f"<span>{label}</span>", "")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('done')
