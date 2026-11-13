import { useState } from 'react'
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
    const res = await window.api.createToken(remark.trim())
    setBusy(false)
    if (!res.ok) {
      notify(res.error ?? '生成失败')
      return
    }
    setRemark('')
    setModal(false)
    notify('已生成', 'ok')
    await onChanged()
  }

  const remove = async (id: string, label: string): Promise<void> => {
    if (!confirm(`删除 token「${label}」？`)) return
    const res = await window.api.deleteToken(id)
    if (!res.ok) notify(res.error ?? '删除失败')
    else {
      notify('已删除', 'ok')
      await onChanged()
    }
  }

  const local = `http://127.0.0.1:${config.settings.port}`
  const lan = `http://${config.settings.lanIp}:${config.settings.port}`

  return (
    <div className="section">
      <div className="card">
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

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>接入 Token</h2>
          <button className="btn primary" onClick={() => setModal(true)}>
            生成 Token
          </button>
        </div>

        <table className="tbl tbl-left tbl-access mt col-fixed">
          <thead>
            <tr>
              <th>备注</th>
              <th>Token（点击复制）</th>
              <th>创建时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {config.settings.tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.remark}</td>
                <td>
                  <span className="copy-text mono" onClick={() => void copy(t.token)}>
                    {t.masked}
                  </span>
                </td>
                <td className="mono">{new Date(t.createdAt).toLocaleString()}</td>
                <td>
                  <button
                    className="btn sm"
                    disabled={config.settings.tokens.length <= 1}
                    onClick={() => void remove(t.id, t.remark)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal ? (
        <div className="mask" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>生成 Token</h3>
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
              <button className="btn" onClick={() => setModal(false)}>
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void create()}>
                生成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
