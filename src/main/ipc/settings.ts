import type { SettingsPatch } from '../../shared/ipc/contract'
import * as cfg from '../store/config'
import * as proxy from '../proxy/server'
import * as rate from '../rate'
import * as calibrate from '../calibrate'
import * as settings from '../settings/service'
import { handle, wrap } from './shared'

export function register(): void {
  handle(
    'updateSettings',
    wrap((patch: SettingsPatch) => {
      // 校验、落盘与副作用都归 settings/service，这里只转发
      settings.update(patch)
      return true
    })
  )

  handle(
    'restartProxy',
    wrap(() => proxy.start(cfg.get().settings.port))
  )

  handle(
    'refreshRate',
    wrap(() => rate.refresh())
  )

  handle(
    'calibrate',
    wrap(() => calibrate.run())
  )
}
