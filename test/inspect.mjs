import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const data = join(process.env.APPDATA ?? '', 'llm-meter', 'data')
const d = new Date()
const p = (n) => String(n).padStart(2, '0')
const file = join(data, 'events', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.jsonl`)

if (!existsSync(file)) {
  console.log('今天还没有 events 文件:', file)
  process.exit(0)
}

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  .filter(Boolean)

console.log('今天共', rows.length, '条')
for (const r of rows.slice(-15)) {
  const time = new Date(r.ts).toTimeString().slice(0, 8)
  console.log(
    `${time} ok=${r.ok} st=${r.status} alias=${r.alias} kind=${r.errorKind ?? '-'} in=${r.inputTokens} out=${r.outputTokens} note=${r.note ?? ''}`
  )
}
