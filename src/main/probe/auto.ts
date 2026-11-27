import * as cfg from '../store/config'
import * as live from '../store/live'
import * as ping from './ping'

/**
 * 自动探针调度：每 5 秒检查一次，最多发一条（天然串行、约 5 秒起步间隔）。
 * 连续失败 3 次把该模型的间隔降为 30 分钟，成功一次恢复。
 */
const TICK_MS = 5000
const BACKOFF_FAILS = 3
const BACKOFF_SEC = 1800

const nextAt = new Map<string, number>()
let timer: NodeJS.Timeout | null = null

function tick(): void {
  const now = Date.now()
  for (const m of cfg.listModels()) {
    if (!m.enabled || !m.autoProbe) {
      nextAt.delete(m.id)
      continue
    }
    if ((nextAt.get(m.id) ?? 0) > now) continue
    const interval = live.probeFailsOf(m.id) >= BACKOFF_FAILS ? BACKOFF_SEC : cfg.get().settings.autoProbeIntervalSec
    nextAt.set(m.id, now + interval * 1000)
    void ping.ping(m.id).catch(() => undefined)
    return // 一轮只发一条
  }
}

export function start(): void {
  if (timer) return
  timer = setInterval(tick, TICK_MS)
}

export function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}
