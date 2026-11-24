import { Menu } from 'electron'
import * as cfg from '../../store/config'
import * as settingsService from '../../settings/service'
import { getOverlay } from '../registry'

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
