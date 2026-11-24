import { describe, expect, it } from 'vitest'
import { cost, hitRate, tps, fmtMoney, fmtTokens } from '../src/main/metrics/cost'

describe('命中率', () => {
  it('缓存读取 / 输入总量', () => {
    expect(hitRate({ input: 1200, uncached: 120, output: 0, cacheRead: 1080, cacheInput: 0 })).toBeCloseTo(0.9)
  })

  it('没有输入时为 null', () => {
    expect(hitRate({ input: 0, uncached: 0, output: 10, cacheRead: 0, cacheInput: 0 })).toBeNull()
  })

  it('全部命中为 1', () => {
    expect(hitRate({ input: 500, uncached: 0, output: 0, cacheRead: 500, cacheInput: 0 })).toBe(1)
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
  const model = { priceIn: 3, priceOut: 15, priceCacheRead: 0.3, priceCacheInput: 3.75 }

  it('缓存部分不再按原价重复计费', () => {
    // 未命中部分 = 1200 - 1080 - 100 = 20
    const c = cost(model, { input: 1200, uncached: 20, output: 460, cacheRead: 1080, cacheInput: 100 })
    const expected = (20 * 3 + 460 * 15 + 1080 * 0.3 + 100 * 3.75) / 1_000_000
    expect(c).toBeCloseTo(expected)
  })

  it('与手算一致：320M 输入 99.5% 命中、0.296M 输出', () => {
    const m = { priceIn: 2.01, priceOut: 8.02, priceCacheRead: 0.04, priceCacheInput: 0 }
    const c = cost(m, {
      input: 320_000_000,
      uncached: 1_600_000,
      output: 296_000,
      cacheRead: 318_400_000,
      cacheInput: 0
    })
    expect(c).toBeCloseTo(18.32592, 4)
  })

  it('缓存价缺失时按输入价兜底', () => {
    const m = { priceIn: 2, priceOut: 0, priceCacheRead: 0, priceCacheInput: 0 }
    expect(cost(m, { input: 1000, uncached: 0, output: 0, cacheRead: 600, cacheInput: 400 })).toBeCloseTo(
      (1000 * 2) / 1e6
    )
  })

  it('全零价格得零', () => {
    expect(
      cost(
        { priceIn: 0, priceOut: 0, priceCacheRead: 0, priceCacheInput: 0 },
        { input: 1000, uncached: 1000, output: 1000, cacheRead: 0, cacheInput: 0 }
      )
    ).toBe(0)
  })
})

describe('展示格式', () => {
  it('大数缩写', () => {
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(1234)).toBe('1.2k')
    expect(fmtTokens(2_500_000)).toBe('2.5M')
  })

  it('金额固定一位小数', () => {
    expect(fmtMoney(0.0043, 'USD')).toBe('$0.0')
    expect(fmtMoney(1.5, 'USD')).toBe('$1.5')
    expect(fmtMoney(0, 'USD')).toBe('$0.0')
    expect(fmtMoney(0.0043)).toBe('¥0.0')
  })

  it('按货币换符号', () => {
    expect(fmtMoney(2, 'CNY')).toBe('¥2.0')
    expect(fmtMoney(2, 'EUR')).toBe('€2.0')
  })
})
