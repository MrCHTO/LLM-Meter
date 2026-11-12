/**
 * 用 Electron 离屏渲染 resources/icon.svg，产出：
 *   resources/icon.png   256×256
 *   resources/icon.ico   16-256 全尺寸（PNG 帧）
 *   resources/tray.ico   16/24/32
 * 运行：node node_modules/electron/cli.js scripts/make-icons.mjs
 */
import { app, BrowserWindow, nativeImage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SVG = join(ROOT, 'resources', 'icon.svg')
const SIZES = [256, 128, 64, 48, 32, 24, 16]
const TRAY_SIZES = [32, 24, 16]

/** PNG 帧拼 ICO（Vista 起支持 PNG 帧，Windows/Electron 都认） */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = Buffer.alloc(16 * pngs.length)
  let offset = 6 + entries.length
  const blobs = []
  pngs.forEach((p, i) => {
    const e = entries.subarray(i * 16, i * 16 + 16)
    e.writeUInt8(p.size === 256 ? 0 : p.size, 0)
    e.writeUInt8(p.size === 256 ? 0 : p.size, 1)
    e.writeUInt8(0, 2) // 调色板色数
    e.writeUInt8(0, 3) // 保留
    e.writeUInt16LE(1, 4) // 平面
    e.writeUInt16LE(32, 6) // 位深
    e.writeUInt32LE(p.data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += p.data.length
    blobs.push(p.data)
  })
  return Buffer.concat([header, entries, ...blobs])
}

const render = async () => {
  await app.whenReady()
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: { offscreen: true }
  })
  const svg = readFileSync(SVG, 'utf8')
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body>${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 400)) // 等首帧合成
  const master = await win.webContents.capturePage()
  if (master.isEmpty() || master.getSize().width === 0) throw new Error('capturePage 得到空图')

  const pngs = SIZES.map((size) => ({
    size,
    data: master.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }))

  writeFileSync(join(ROOT, 'resources', 'icon.png'), pngs.find((p) => p.size === 256).data)
  writeFileSync(join(ROOT, 'resources', 'icon.ico'), buildIco(pngs))
  writeFileSync(
    join(ROOT, 'resources', 'tray.ico'),
    buildIco(pngs.filter((p) => TRAY_SIZES.includes(p.size)))
  )
  win.destroy()

  // 自检：两个 ico 都要能读回非空图
  for (const f of ['icon.ico', 'tray.ico']) {
    const img = nativeImage.createFromPath(join(ROOT, 'resources', f))
    if (img.isEmpty()) throw new Error(`${f} 读回为空`)
    console.log(`${f} ok, ${img.getSize().width}x${img.getSize().height}`)
  }
  console.log('icon.png 256 ok,', pngs.find((p) => p.size === 256).data.length, 'bytes')
  app.quit()
}

render().catch((err) => {
  console.error(err)
  app.quit(1)
})
