import { deflateSync } from 'node:zlib'
import { writeFileSync, statSync } from 'node:fs'

const S = 256
const raw = Buffer.alloc((S * 4 + 1) * S)
const bg = [15, 18, 22]
const accent = [77, 163, 255]
const bars = [
  [64, 196],
  [112, 150],
  [160, 120]
]

for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  for (let x = 0; x < S; x++) {
    const o = y * (S * 4 + 1) + 1 + x * 4
    const inBox = x >= 28 && x <= 227 && y >= 28 && y <= 227
    const r = Math.hypot(x - 128, y - 128)
    let on = false
    let heat = 0
    for (const [bx, top] of bars) {
      if (x >= bx && x <= bx + 34 && y >= top && y <= 196) {
        on = true
        heat = Math.max(heat, 1 - (y - top) / 160)
      }
    }
    let c
    if (!inBox || r > 118) c = [0, 0, 0, 0]
    else if (on) c = [Math.round(accent[0] * (0.6 + 0.4 * heat)), Math.round(accent[1] * (0.7 + 0.3 * heat)), 255, 255]
    else c = [bg[0], bg[1], bg[2], 255]
    raw[o] = c[0]
    raw[o + 1] = c[1]
    raw[o + 2] = c[2]
    raw[o + 3] = c[3]
  }
}

const idat = deflateSync(raw, { level: 9 })
const crc = (b) => {
  let c = ~0
  for (const x of b) {
    c ^= x
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
])
writeFileSync('resources/icon.png', png)

const head = Buffer.alloc(22)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(1, 4)
head.writeUInt16LE(1, 10)
head.writeUInt16LE(32, 12)
head.writeUInt32LE(png.length, 14)
head.writeUInt32LE(22, 18)
writeFileSync('resources/icon.ico', Buffer.concat([head, png]))
console.log('png', statSync('resources/icon.png').size, 'ico', statSync('resources/icon.ico').size)
