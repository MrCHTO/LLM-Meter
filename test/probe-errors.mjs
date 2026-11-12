import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.env.APPDATA ?? '', 'llm-meter', 'data', 'events')
if (!existsSync(dir)) {
  console.log('没有 events 目录')
  process.exit(0)
}

const files = readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().slice(-2)
for (const name of files) {
  const rows = readFileSync(join(dir, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .filter((r) => r.source === 'probe')
  if (rows.length === 0) continue
  console.log(`## ${name} 探测记录 ${rows.length} 条`)
  for (const r of rows.slice(-6)) {
    console.log(
      new Date(r.ts).toTimeString().slice(0, 8),
      r.alias,
      `st=${r.status}`,
      r.errorKind ?? '-',
      '|',
      (r.note ?? '').slice(0, 200)
    )
  }
}
