import { useEffect, useState } from 'react'
import type { ConfigView } from '../../shared/types'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

export function Access({ config, notify, onChanged }: Props): JSX.Element {
  const [remark, setRemark] = useState('')
  const [modal, setModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [port, setPort] = useState(String(config.settings.port))
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 正在改备注的 token；null 表示新建 */
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const patch = async (value: { allowLan?: boolean; port?: number }): Promise<void> => {
    const res = await window.api.updateSettings(value)
    if (!res.ok) notify(res.error ?? '保存失败')
    else await onChanged()
  }

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      notify('已复制', 'ok')
    } catch {
      notify(`复制失败：${text}`)
    }
  }

  const create = async (): Promise<void> => {
    if (!remark.trim()) {
      notify('备注必须填写')
      return
    }
    setBusy(true)
    const res = editing
      ? await window.api.updateToken(editing, remark.trim())
      : await window.api.createToken(remark.trim())
    setBusy(false)
    if (!res.ok) {
      notify(res.error ?? '保存失败')
      return
    }
    setRemark('')
    setEditing(null)
    setModal(false)
    notify(editing ? '备注已修改' : '已生成', 'ok')
    await onChanged()
  }

  const remove = async (id: string, label: string): Promise<void> => {
    const res = await window.api.deleteToken(id)
    if (!res.ok) notify(res.error ?? '删除失败')
    else {
      notify(`已删除「${label}」`, 'ok')
      await onChanged()
    }
  }

  const local = `http://127.0.0.1:${config.settings.port}`
  const lan = `http://${config.settings.lanIp}:${config.settings.port}`

  return (
    <div className="section">
      <div className="card">
        <div className="access-cols">
          <div className="access-cols-left">
            <h2>客户端接入</h2>
            <dl className="kv kv-wide">
              <dt>本机地址</dt>
              <dd>
                <span className="copy-text mono" onClick={() => void copy(local)}>
                  {local}
                </span>
              </dd>
              {config.settings.allowLan ? (
                <>
                  <dt>局域网地址</dt>
                  <dd>
                    <span className="copy-text mono" onClick={() => void copy(lan)}>
                      {lan}
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
          <div className="access-cols-right">
            <div className="access-split">
          <div className="access-half">
            <span className="muted">监听端口</span>
            <div className="row nowrap" style={{ gap: 8 }}>
              <input
                className="mono w-sm"
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
              <button
                className="btn sm"
                onClick={async () => {
                  const value = Number(port)
                  if (!value || value < 1024 || value > 65535) {
                    notify('端口需要在 1024-65535')
                    return
                  }
                  await patch({ port: value })
                  notify('端口已应用', 'ok')
                }}
              >
                应用
              </button>
            </div>
          </div>
          <div className="access-half">
            <span className="muted">允许局域网访问</span>
            <input
              type="checkbox"
              checked={config.settings.allowLan}
              onChange={(e) => void patch({ allowLan: e.target.checked })}
            />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>接入 Token</h2>
          <button
            className="btn primary"
            onClick={() => {
              setEditing(null)
              setRemark('')
              setModal(true)
            }}
          >
            生成 Token
          </button>
        </div>

        <table className="tbl tbl-left tbl-access mt">
          <thead>
            <tr>
              <th>备注</th>
              <th>Token（点击复制）</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {config.settings.tokens.map((t) => (
              <tr
                key={t.id}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ id: t.id, x: e.clientX, y: e.clientY })
                }}
              >
                <td>{t.remark}</td>
                <td>
                  <span className="copy-text mono" onClick={() => void copy(t.token)}>
                    {t.masked}
                  </span>
                </td>
                <td className="mono">{new Date(t.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {menu
          ? (() => {
              const t = config.settings.tokens.find((x) => x.id === menu.id)
              if (!t) return null
              return (
                <div
                  className="ctxmenu"
                  style={{ left: Math.min(menu.x, window.innerWidth - 140), top: Math.min(menu.y, window.innerHeight - 90) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setMenu(null)
                      setEditing(t.id)
                      setRemark(t.remark)
                      setModal(true)
                    }}
                  >
                    修改备注
                  </button>
                  <button
                    onClick={() => {
                      setMenu(null)
                      void remove(t.id, t.remark)
                    }}
                  >
                    删除
                  </button>
                </div>
              )
            })()
          : null}
      </div>

      {modal ? (
        <div className="mask" onClick={() => { setModal(false); setEditing(null) }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? '修改备注' : '生成 Token'}</h3>
            <label className="field">
              <span>备注（必填）</span>
              <input
                type="text"
                value={remark}
                autoFocus
                placeholder="例如：笔记本 / 脚本 / 某项目"
                onChange={(e) => setRemark(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
              />
            </label>
            <div className="actions">
              <button className="btn" onClick={() => { setModal(false); setEditing(null) }}>
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void create()}>
                {editing ? '保存' : '生成'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
