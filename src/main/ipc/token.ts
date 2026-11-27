import { randomUUID } from 'node:crypto'
import * as cfg from '../store/config'
import * as db from '../store/db'
import * as repo from '../store/db/repo'
import * as applog from '../applog'
import * as token from '../security/token'
import { handle, wrap } from './shared'

function cleanRemark(input: string): string {
  const remark = String(input ?? '').trim()
  if (!remark) throw new Error('备注必须填写')
  if (remark.length > 40) throw new Error('备注最长 40 个字')
  return remark
}

export function register(): void {
  handle(
    'rotateToken',
    wrap(() => {
      const issued = token.issue()
      cfg.mutate((c) => {
        c.settings.localKey = issued.key
        c.settings.localToken = issued.token
      })
      return issued.token
    })
  )

  handle(
    'createToken',
    wrap((remarkInput: string) => {
      const remark = cleanRemark(remarkInput)
      if (cfg.get().settings.tokens.some((t) => t.remark === remark)) throw new Error(`备注 ${remark} 已存在`)
      const issued = token.issue()
      const created = { id: randomUUID(), remark, token: issued.token, createdAt: Date.now() }
      cfg.mutate((c) => {
        c.settings.tokens.push(created)
      })
      return { ...created, masked: token.masked(created.token) }
    })
  )

  handle(
    'deleteToken',
    wrap((id: string) => {
      const list = cfg.get().settings.tokens
      if (list.length <= 1) throw new Error('至少保留一个 token')
      cfg.mutate((c) => {
        c.settings.tokens = c.settings.tokens.filter((t) => t.id !== id)
      })
      return true
    })
  )

  handle(
    'updateToken',
    wrap((id: string, remarkInput: string) => {
      const remark = cleanRemark(remarkInput)
      const list = cfg.get().settings.tokens
      const target = list.find((t) => t.id === id)
      if (!target) throw new Error('token 不存在')
      if (list.some((t) => t.id !== id && t.remark === remark)) throw new Error(`备注 ${remark} 已存在`)
      const from = target.remark
      cfg.mutate((c) => {
        const t = c.settings.tokens.find((x) => x.id === id)
        if (t) t.remark = remark
      })
      // 备注变了，历史明细按 token_id 改名，聚合从明细整表重建
      if (from !== remark) {
        repo.renameTokenRemark(db.get(), id, from, remark)
        applog.info('access', `Token 备注改名 ${from} → ${remark}，历史与聚合已跟随`)
      }
      return true
    })
  )
}
