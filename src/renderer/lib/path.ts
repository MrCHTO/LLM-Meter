/** Catmull-Rom 转三次贝塞尔的平滑折线，端点重复取端点值 */

export function smoothPath(points: { x: number; y: number }[], clampTo: { min: number; max: number }): string {
  if (points.length === 0) return ''
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M${first.x.toFixed(2)},${first.y.toFixed(2)}`
  const clamp = (v: number): number => Math.min(clampTo.max, Math.max(clampTo.min, v))
  const at = (i: number): { x: number; y: number } => points[Math.max(0, Math.min(points.length - 1, i))] ?? first
  let d = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6)
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6)
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}
