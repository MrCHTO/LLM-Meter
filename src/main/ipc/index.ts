/** 通道注册入口：按域拆到同级文件，这里只负责汇总 */

import * as dev from './dev'
import * as logs from './logs'
import * as model from './model'
import * as overlay from './overlay'
import * as provider from './provider'
import * as settings from './settings'
import * as stats from './stats'
import * as token from './token'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  provider.register()
  model.register()
  token.register()
  settings.register()
  logs.register()
  stats.register()
  dev.register()
  overlay.register()
}
