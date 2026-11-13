import { CH } from '../shared/types'
import * as cfg from './store/config'
import * as pricing from './pricing'
import * as rate from './rate'
import { send } from './windows/registry'

/**
 * 启动与每天 00:00 的自动校准：拉当天汇率，再把所有「自动价」模型按
 * OpenRouter 精确 id 重新折算成人民币。手动价的模型不动。
 */
let running = false

export async function run(): Promise<void> {
  if (running || !cfg.get().settings.autoCalibrate) return
  running = true
  try {
    const r = await rate.refresh()
    const targets = cfg.listModels().filter((m) => m.enabled && m.priceSource === 'auto')

    const updates: { id: string; in: number; out: number; read: number; write: number }[] = []
    let missed = 0
    for (const m of targets) {
      const hit = await pricing.lookup(m.upstreamModel)
      if (hit.found && hit.exact && (hit.priceIn || hit.priceOut)) {
        updates.push({
          id: m.id,
          in: (hit.priceIn ?? 0) * r.rate,
          out: (hit.priceOut ?? 0) * r.rate,
          read: (hit.priceCacheRead ?? 0) * r.rate,
          write: (hit.priceCacheWrite ?? 0) * r.rate
        })
      } else if (!hit.found) {
        missed++
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    const at = Date.now()
    cfg.mutate((c) => {
      for (const u of updates) {
        const target = c.models.find((x) => x.id === u.id)
        // 校准期间被手改成 manual 的就跳过
        if (!target || target.priceSource === 'manual') continue
        target.priceIn = u.in
        target.priceOut = u.out
        target.priceCacheRead = u.read
        target.priceCacheWrite = u.write
        target.currency = 'CNY'
      }
      c.settings.lastCalibrate = { at, rate: r.rate, updated: updates.length, missed }
    })
    send(CH.calibrated, { rate: r.rate, updated: updates.length, missed })
  } catch {
    /* 断网就下次再说 */
  } finally {
    running = false
  }
}
