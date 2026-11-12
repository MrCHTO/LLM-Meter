import { describe, expect, it } from 'vitest'
import { cost, hitRate, tps, fmtMoney, fmtTokens } from '../src/main/metrics/cost'

describe('命中率', () => {
  it('缓存读 / 输入总量', () => {
    expect(hitRate({ input: 1200, output: 0, cacheRead: 1080, cacheWrite: 0 })).toBeCloseTo(0.9)
  })

  it('没有输入时为 null', () => {
    expect(hitRate({ input: 0, output: 10, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })

  it('全部命中为 1', () => {
    expect(hitRate({ input: 500, output: 0, cacheRead: 500, cacheWrite: 0 })).toBe(1)
  })
})

describe('tok/s', () => {
  it('用生成窗口算', () => {
    expect(tps(460, 7400, 380)).toBeCloseTo(460 / 7.02)
  })

  it('非流式（无首字时间）返回 null', () => {
    expect(tps(460, 7400, null)).toBeNull()
  })

  it('没有输出返回 null', () => {
    expect(tps(0, 1000, 100)).toBeNull()
  })

  it('窗口为 0 时不会除零', () => {
    expect(tps(10, 500, 500)).toBe(10 / 0.001)
  })
})

describe('成本', () => {
  const model = { priceIn: 3, priceOut: 15, priceCacheRead: 0.3, priceCacheWrite: 3.75 }

  it('按每百万 token 折算四项', () => {
    const c = cost(model, { input: 1200, output: 460, cacheRead: 1080, cacheWrite: 100 })
    const expected = (1200 * 3 + 460 * 15 + 1080 * 0.3 + 100 * 3.75) / 1_000_000
    expect(c).toBeCloseTo(expected)
  })

  it('全零价格得零', () => {
    expect(cost({ priceIn: 0, priceOut: 0, priceCacheRead: 0, priceCacheWrite: 0 }, { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 })).toBe(0)
  })
})

describe('展示格式', () => {
  it('大数缩写', () => {
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(1234)).toBe('1.2k')
    expect(fmtTokens(2_500_000)).toBe('2.5M')
  })

  it('小额用四位小数', () => {
    expect(fmtMoney(0.0043)).toBe('$0.0043')
    expect(fmtMoney(1.5)).toBe('$1.50')
    expect(fmtMoney(0)).toBe('$0')
  })

  it('按货币换符号', () => {
    expect(fmtMoney(2, 'CNY')).toBe('¥2.00')
    expect(fmtMoney(2, 'EUR')).toBe('€2.00')
  })
})
