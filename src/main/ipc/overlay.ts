import { screen } from 'electron'
import * as cfg from '../store/config'
import * as overlayWin from '../windows/overlay'
import { showMain } from '../windows/registry'
import { handle, wrap } from './shared'

export function register(): void {
  handle(
    'overlayDragStart',
    wrap(() => overlayWin.startDrag())
  )
  handle(
    'overlayDragEnd',
    wrap(() => overlayWin.stopDrag())
  )
  handle(
    'overlayHover',
    wrap((value: boolean) => overlayWin.setHover(value))
  )
  handle(
    'overlayMenu',
    wrap(() => overlayWin.showMenu())
  )
  handle(
    'overlayOpenMain',
    wrap(() => showMain())
  )
  handle(
    'overlaySetSize',
    wrap((width: number, height: number) => overlayWin.resize(width, height))
  )
  handle(
    'overlayState',
    wrap(() => {
      const bounds = overlayWin.bounds()
      if (!bounds) return null
      return { bounds, area: screen.getDisplayMatching(bounds).workArea, opacity: cfg.get().settings.overlayOpacity }
    })
  )
  handle(
    'openMain',
    wrap(() => showMain())
  )
}
