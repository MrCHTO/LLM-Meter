import { describe, expect, it } from 'vitest'
import { anchorX, snapCenter } from '../src/main/windows/snap'

const area = { x: 0, y: 0, width: 1000, height: 800 }

describe('宽度锚点', () => {
  it('两侧都不贴边时以中心对称伸缩', () => {
    expect(anchorX({ x: 400, y: 100, width: 200, height: 40 }, 300, area, 500)).toBe(350)
  })

  it('贴左边时保持左缘', () => {
    expect(anchorX({ x: 0, y: 100, width: 200, height: 40 }, 300, area, 100)).toBe(0)
  })

  it('贴右边时保持右缘', () => {
    expect(anchorX({ x: 800, y: 100, width: 200, height: 40 }, 260, area, 900)).toBe(740)
  })

  it('变窄同样对称', () => {
    expect(anchorX({ x: 400, y: 100, width: 300, height: 40 }, 200, area, 550)).toBe(450)
  })

  it('宽度反复变化不会向右累积漂移', () => {
    const center = 500
    let b = { x: 400, y: 100, width: 200, height: 40 }
    const xs: number[] = []
    for (let i = 0; i < 50; i++) {
      const width = 183 + (i % 2)
      b = { ...b, x: anchorX(b, width, area, center), width }
      xs.push(b.x)
    }
    // 同一宽度永远落同一个值，不随次数递增
    expect(xs.filter((_, i) => i % 2 === 0)).toEqual(Array(25).fill(409))
    expect(xs.filter((_, i) => i % 2 === 1)).toEqual(Array(25).fill(408))
  })
})

describe('中线吸附', () => {
  const rect = { x: 480, y: 380, width: 40, height: 40 } // 中心 500,400

  it('靠近横纵中线时两轴都吸附', () => {
    expect(snapCenter({ ...rect, x: 483, y: 384 }, area)).toEqual({ x: 480, y: 380 })
  })

  it('超出阈值不吸附', () => {
    expect(snapCenter({ ...rect, x: 460, y: 360 }, area)).toEqual({ x: 460, y: 360 })
  })

  it('只吸附接近的一轴', () => {
    expect(snapCenter({ ...rect, x: 483, y: 300 }, area)).toEqual({ x: 480, y: 300 })
  })
})
