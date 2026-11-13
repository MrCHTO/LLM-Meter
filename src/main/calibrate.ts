import { CH } from '../shared/types'
import * as cfg from './store/config'
import * as pricing from './pricing'
import * as rate from './rate'
import { send } from './windows/registry'
import * as applog from './applog'

/**
 * 启动与每天 00:00 的自动校准：拉当天汇率，再把所有「自动价」模型按
 * OpenRouter 精确 id 重新折算成人民币。手动价的模型不动。
 */
let running = false

export async function run(): Promise<void> {
  if (running || !cfg.get().settings.autoCalibrate) return
  running = true
  try {
    applog.info('calibrate', '开始校准汇率与自动价')
    const r = await rate.refresh()
    const targets = cfg.listModels().filter((m) => m.enabled && m.priceSource === 'auto')

    const updates: { id: string; in: number; out: number; read: number; write: number }[] = []
    let missed = 0
    for (const m of targets) {
      const hit = await pricing.lookup(m.upstreamModel)
      applog.info(
        'calibrate',
        `${m.alias} found=${hit.found} source=${hit.source ?? '-'} exact=${hit.exact ?? '-'} in=${hit.priceIn ?? '-'} matched=${hit.matchedId ?? '-'}`
      )
      // 官方目录的命中靠名称归一化，通常是近似；官方源可信，近似也应用
      const trust = hit.found && (hit.exact || hit.source === 'official')
      if (trust && (hit.priceIn || hit.priceOut)) {
        updates.push({
          id: m.id,
          in: (hit.priceIn ?? 0) * r.rate,
          out: (hit.priceOut ?? 0) * r.rate,
          read: (hit.priceCacheRead ?? 0) * r.rate,
          write: (hit.priceCacheInput ?? 0) * r.rate
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
        target.priceCacheInput = u.write
        target.currency = 'CNY'
      }
      c.settings.lastCalibrate = { at, rate: r.rate, updated: updates.length, missed }
    })
    send(CH.calibrated, { rate: r.rate, updated: updates.length, missed })
    applog.info(
      'calibrate',
      `校准完成：汇率 ${r.rate.toFixed(4)}，更新 ${updates.length} 个，未匹配 ${missed} 个`
    )
  } catch (err) {
    applog.error('calibrate', `校准失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    running = false
  }
}
