import { describe, expect, it } from 'vitest'
import { anchorX, SNAP, snapToEdges } from '../src/main/windows/snap'

const area = { x: 0, y: 0, width: 1000, height: 800 }

describe('边缘吸附', () => {
  it('离左边 5px 时吸到 0', () => {
    expect(snapToEdges({ x: 5, y: 300, width: 200, height: 40 }, area).x).toBe(0)
  })

  it('离右边不足阈值时吸到右缘', () => {
    expect(snapToEdges({ x: 1000 - 200 - 8, y: 300, width: 200, height: 40 }, area).x).toBe(800)
  })

  it('上下同样吸附', () => {
    const out = snapToEdges({ x: 400, y: 790 - 40 + 6, width: 200, height: 40 }, area)
    expect(out.y).toBe(800 - 40)
    expect(snapToEdges({ x: 400, y: 7, width: 200, height: 40 }, area).y).toBe(0)
  })

  it('离边超过阈值不动', () => {
    const out = snapToEdges({ x: SNAP + 1, y: 300, width: 200, height: 40 }, area)
    expect(out.x).toBe(SNAP + 1)
    expect(out.y).toBe(300)
  })

  it('贴边同时成立时取更近的一边', () => {
    // 窗口比屏还宽时左右都会「贴边」，取差值更小的
    const out = snapToEdges({ x: 3, y: 0, width: 1010, height: 40 }, area)
    expect(out.x).toBe(0)
  })
})

describe('宽度锚点', () => {
  it('两侧都不贴边时以中心对称伸缩', () => {
    expect(anchorX({ x: 400, y: 100, width: 200, height: 40 }, 300, area)).toBe(350)
  })

  it('贴左边时保持左缘', () => {
    expect(anchorX({ x: 0, y: 100, width: 200, height: 40 }, 300, area)).toBe(0)
  })

  it('贴右边时保持右缘', () => {
    expect(anchorX({ x: 800, y: 100, width: 200, height: 40 }, 260, area)).toBe(740)
  })

  it('变窄同样对称', () => {
    expect(anchorX({ x: 400, y: 100, width: 300, height: 40 }, 200, area)).toBe(450)
  })
})
