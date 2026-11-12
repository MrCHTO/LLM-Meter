import { appendFileSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey, ensureDirs, eventsDir } from './paths'
import type { RequestEvent } from '../../shared/types'

const FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/

function fileFor(ts: number): string {
  return join(eventsDir(), `${dayKey(ts)}.jsonl`)
}

/** 追加一行。写失败只记日志，不影响请求本身。 */
export function append(ev: RequestEvent): void {
  try {
    ensureDirs()
    appendFileSync(fileFor(ev.ts), `${JSON.stringify(ev)}\n`, 'utf8')
  } catch (err) {
    console.error('[events] append failed', err)
  }
}

/** 读取 [from, to] 区间内的事件，用于启动回放。坏行跳过。 */
export function readRange(from: number, to: number): RequestEvent[] {
  const out: RequestEvent[] = []
  const days = new Set<string>()
  for (let t = from; t <= to; t += 6 * 3600_000) days.add(dayKey(t))
  days.add(dayKey(to))

  for (const day of days) {
    let text: string
    try {
      text = readFileSync(join(eventsDir(), `${day}.jsonl`), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line) continue
      let ev: RequestEvent
      try {
        ev = JSON.parse(line) as RequestEvent
      } catch {
        continue
      }
      if (typeof ev.ts === 'number' && ev.ts >= from && ev.ts <= to) out.push(ev)
    }
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

/** 按天删除过期明细。 */
export function cleanup(retentionDays: number): void {
  const cutoff = dayKey(Date.now() - retentionDays * 86400_000)
  let names: string[]
  try {
    names = readdirSync(eventsDir())
  } catch {
    return
  }
  for (const name of names) {
    if (!FILE_RE.test(name)) continue
    if (name.slice(0, 10) >= cutoff) continue
    try {
      unlinkSync(join(eventsDir(), name))
    } catch {
      /* 忽略 */
    }
  }
}

export function sizeOfDay(ts = Date.now()): number {
  try {
    return statSync(fileFor(ts)).size
  } catch {
    return 0
  }
}
