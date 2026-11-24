import { BrowserWindow, Menu, screen } from 'electron'
import { join } from 'node:path'
import type { Rectangle } from 'electron'
import * as cfg from '../store/config'
import * as settingsService from '../settings/service'
import { LIMITS } from '../../shared/limits'
import { getOverlay, setOverlay } from './registry'
import { anchorX } from './snap'

/** 只留状态点时也要能贴住内容，最小宽度按状态点圆点定 */
const MIN_WIDTH = 56
const MIN_HEIGHT = 36
const DEFAULT_WIDTH = LIMITS.overlayWidth.fallback
const DEFAULT_HEIGHT = 40

let hovered = false
let dragTimer: NodeJS.Timeout | null = null
let dragOffset = { x: 0, y: 0 }
/**
 * 中心锚点用浮点保存。窗口宽度随内容频繁变化时，若每次按当前整数边界重新取中心，
 * 半像素的取整误差会单向累积，胶囊就会一点点往右挪。
 */
let centerAnchor: number | null = null

function trackCenter(b: Rectangle): void {
  centerAnchor = b.x + b.width / 2
}

function centerOf(b: Rectangle): number {
  if (centerAnchor === null) centerAnchor = b.x + b.width / 2
  return centerAnchor
}

function defaultBounds(): Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.max(MIN_WIDTH, cfg.get().settings.overlay.width)
  const height = DEFAULT_HEIGHT
  return {
    width,
    height,
    x: area.x + area.width - width - 24,
    y: area.y + 24
  }
}

/** 落在已拔掉的显示器上时，钳回最近的主屏工作区。 */
function clampBounds(b: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(b)
  const area = display.workArea
  const width = Math.min(Math.max(MIN_WIDTH, b.width), Math.max(MIN_WIDTH, area.width - 16))
  const height = Math.min(Math.max(MIN_HEIGHT, b.height), Math.max(MIN_HEIGHT, area.height - 16))
  const x = Math.min(Math.max(area.x, b.x), area.x + area.width - width)
  const y = Math.min(Math.max(area.y, b.y), area.y + area.height - height)
  return { x, y, width, height }
}

function currentBounds(): Rectangle {
  const win = getOverlay()
  if (!win) return defaultBounds()
  return win.getBounds()
}

export function applySettings(): void {
  const win = getOverlay()
  if (!win) return
  const s = cfg.get().settings
  // 锁定后鼠标事件完全穿透到下层窗口，解锁只能在托盘
  if (s.overlay.locked) hovered = false
  win.setIgnoreMouseEvents(s.overlay.locked)
  win.setOpacity(hovered ? 1 : s.overlayOpacity / 100)
}

export function create(): BrowserWindow {
  const stored = cfg.get().settings.overlay
  const base =
    stored.x === null || stored.y === null
      ? defaultBounds()
      : clampBounds({ x: stored.x, y: stored.y, width: stored.width || DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  trackCenter(base)

  const win = new BrowserWindow({
    ...base,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    movable: false,
    alwaysOnTop: true,
    title: 'LLM Meter',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setMenuBarVisibility(false)
  win.setOpacity(hovered ? 1 : cfg.get().settings.overlayOpacity / 100)
  win.setIgnoreMouseEvents(stored.locked)

  win.on('ready-to-show', () => {
    const b = win.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    const fresh = clampBounds({ ...b, x: anchorX(b, b.width, area, centerOf(b)) })
    win.setBounds(fresh)
    trackCenter(fresh)
    if (cfg.get().settings.overlay.visible) win.showInactive()
    saveBounds()
  })

  win.on('closed', () => setOverlay(null))

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  setOverlay(win)
  return win
}

let saveTimer: NodeJS.Timeout | null = null
function saveBounds(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const win = getOverlay()
    if (!win) return
    const b = win.getBounds()
    // 拖拽时位置与宽度高频变化，直接落盘；其余设置项走 settings 服务
    cfg.mutate((c) => {
      c.settings.overlay.x = b.x
      c.settings.overlay.y = b.y
      c.settings.overlay.width = b.width
    })
  }, 400)
}

/** 普通拖动挪位置；锁定时不动。透明度在菜单弹层里调。 */
export function startDrag(): void {
  const win = getOverlay()
  if (!win) return
  if (cfg.get().settings.overlay.locked) return

  const cursor = screen.getCursorScreenPoint()
  const b = win.getBounds()
  dragOffset = { x: cursor.x - b.x, y: cursor.y - b.y }
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = setInterval(() => {
    const w = getOverlay()
    if (!w) return
    const p = screen.getCursorScreenPoint()
    const size = w.getBounds()
    const next = clampBounds({ x: p.x - dragOffset.x, y: p.y - dragOffset.y, width: size.width, height: size.height })
    w.setPosition(next.x, next.y)
  }, 16)
}

export function stopDrag(): void {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  const win = getOverlay()
  if (win) trackCenter(win.getBounds())
  saveBounds()
}

/** 按像素把窗口挪到指定位置（设置页用），落在屏幕外时钳回工作区 */
export function moveTo(x: number, y: number): void {
  const win = getOverlay()
  if (!win) return
  const b = win.getBounds()
  const next = clampBounds({ ...b, x: Math.round(x), y: Math.round(y) })
  win.setPosition(next.x, next.y)
  trackCenter(next)
  saveBounds()
}

export function bounds(): Rectangle | null {
  return getOverlay()?.getBounds() ?? null
} /** 渲染层量出胶囊实际宽高后回传，窗口跟着内容走 */
export function resize(width: number, height: number): void {
  const win = getOverlay()
  if (!win) return
  const b = win.getBounds()
  const widthNext = Math.max(MIN_WIDTH, Math.round(width))
  // 贴边的一侧保持不动，否则按保存的中心点对称伸缩
  const area = screen.getDisplayMatching(b).workArea
  const wantedX = anchorX(b, widthNext, area, centerOf(b))
  const next = clampBounds({
    ...b,
    x: wantedX,
    width: widthNext,
    height: Math.max(MIN_HEIGHT, Math.round(height))
  })
  win.setBounds(next)
  // 被屏幕边界钳动过就以新位置作为中心，后续仍不会被拉回
  if (next.x !== wantedX) trackCenter(next)
}

export function setVisible(visible: boolean): void {
  const win = getOverlay()
  if (!win) return
  if (visible) {
    const b = currentBounds()
    const area = screen.getDisplayMatching(b).workArea
    const widthNext = cfg.get().settings.overlay.width
    const fresh = clampBounds({ ...b, x: anchorX(b, widthNext, area, centerOf(b)), width: widthNext })
    win.setBounds(fresh)
    trackCenter(fresh)
    win.showInactive()
  } else {
    win.hide()
  }
}

export function setHover(value: boolean): void {
  hovered = value
  applySettings()
}

/** 菜单里换胶囊盯的模型 */
function modelSubmenu(): Electron.MenuItemConstructorOptions[] {
  const current = cfg.get().settings.overlay.modelId
  const models = cfg.listModels().filter((m) => m.enabled)
  const all: Electron.MenuItemConstructorOptions = {
    label: '全局（全部模型）',
    type: 'radio',
    checked: cfg.get().settings.overlay.global === true,
    click: () => settingsService.update({ overlayGlobal: true })
  }
  if (models.length === 0) return [all, { label: '没有启用的模型', enabled: false }]
  return [
    all,
    ...models.map((m) => ({
      label: m.alias,
      type: 'radio' as const,
      checked: cfg.get().settings.overlay.global !== true && current === m.id,
      click: () => settingsService.update({ overlayGlobal: false, overlayModelId: m.id })
    }))
  ]
}

export function showMenu(): void {
  const win = getOverlay()
  if (!win) return
  const settings = cfg.get().settings
  const unlock: Electron.MenuItemConstructorOptions = {
    label: '解锁位置',
    click: () => settingsService.update({ overlayLocked: false })
  }
  // 锁定时只给「解锁位置」，其余项都收起来
  const template: Electron.MenuItemConstructorOptions[] = settings.overlay.locked
    ? [unlock]
    : [
        { label: '选择模型', submenu: modelSubmenu() },
        {
          label: '锁定位置',
          click: () => settingsService.update({ overlayLocked: true })
        },
        {
          label: '外观',
          submenu: [
            {
              label: '黑色',
              type: 'radio',
              checked: settings.overlay.theme !== 'light',
              click: () => {
                settingsService.update({ overlayTheme: 'dark' })
              }
            },
            {
              label: '白色',
              type: 'radio',
              checked: settings.overlay.theme === 'light',
              click: () => {
                settingsService.update({ overlayTheme: 'light' })
              }
            }
          ]
        },
        {
          label: '显示内容',
          submenu: [
            {
              label: '供应商名称',
              type: 'checkbox',
              checked: settings.overlay.showProvider !== false,
              click: () => {
                settingsService.update({ overlayShowProvider: !settings.overlay.showProvider })
              }
            },
            {
              label: '模型名称',
              type: 'checkbox',
              checked: settings.overlay.showModel !== false,
              click: () => {
                settingsService.update({ overlayShowModel: !settings.overlay.showModel })
              }
            },
            {
              label: '费用',
              type: 'checkbox',
              checked: settings.overlay.showCost !== false,
              click: () => {
                settingsService.update({ overlayShowCost: !settings.overlay.showCost })
              }
            }
          ]
        }
      ]
  const menu = Menu.buildFromTemplate(template)
  menu.popup({ window: win })
}
