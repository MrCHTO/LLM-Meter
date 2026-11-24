import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'llm-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => ROOT, isPackaged: false } }))

type SettingsModule = typeof import('../src/main/settings/service')
type Limits = typeof import('../src/shared/limits')

let service: SettingsModule
let limits: Limits

beforeEach(async () => {
  vi.resetModules()
  limits = await import('../src/shared/limits')
  service = await import('../src/main/settings/service')
  rmSync(join(ROOT, 'data'), { recursive: true, force: true })
})

describe('数值约束', () => {
  it('超界钳到边界', () => {
    expect(limits.clampInt('port', 80)).toBe(limits.LIMITS.port.min)
    expect(limits.clampInt('port', 99999)).toBe(limits.LIMITS.port.max)
    expect(limits.clampInt('overlayOpacity', 5)).toBe(limits.LIMITS.overlayOpacity.min)
  })

  it('非有限数回落默认值', () => {
    expect(limits.clampInt('autoProbeIntervalSec', Number.NaN)).toBe(limits.LIMITS.autoProbeIntervalSec.fallback)
    expect(limits.clampRate(Number.POSITIVE_INFINITY)).toBe(limits.LIMITS.usdCny.fallback)
  })

  it('汇率保留 4 位并钳进区间', () => {
    expect(limits.clampRate(7.123456)).toBe(7.1235)
    expect(limits.clampRate(0.1)).toBe(limits.LIMITS.usdCny.min)
  })
})

describe('设置写入', () => {
  it('patch 里的越界值被钳制后再落盘', async () => {
    service.update({ port: 70000, autoProbeIntervalSec: 5, overlayWidth: 10 })
    const cfg = await import('../src/main/store/config')
    const s = cfg.get().settings
    expect(s.port).toBe(limits.LIMITS.port.max)
    expect(s.autoProbeIntervalSec).toBe(limits.LIMITS.autoProbeIntervalSec.min)
    expect(s.overlay.width).toBe(limits.LIMITS.overlayWidth.min)
  })

  it('监听者能拿到变更前后与变更键', () => {
    const seen: string[] = []
    const off = service.onChange((c) => seen.push(c.keys.join(',')))
    service.update({ allowLan: true })
    off()
    service.update({ allowLan: false })
    expect(seen).toEqual(['allowLan'])
  })

  it('overlayModelId 传空串归一为 null', async () => {
    service.update({ overlayModelId: '' })
    const cfg = await import('../src/main/store/config')
    expect(cfg.get().settings.overlay.modelId).toBeNull()
  })
})
