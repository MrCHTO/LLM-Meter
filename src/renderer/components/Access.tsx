import { useState } from 'react'
import type { ConfigView } from '../../shared/types'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

export function Access({ config, notify, onChanged }: Props): JSX.Element {
  const [remark, setRemark] = useState('')
  const [port, setPort] = useState(String(config.settings.port))
  const [busy, setBusy] = useState(false)

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      notify('已复制', 'ok')
    } catch {
      notify(`复制失败：${text}`)
    }
  }

  const patch = async (value: { allowLan?: boolean; port?: number }): Promise<void> => {
    const res = await window.api.updateSettings(value)
    if (!res.ok) notify(res.error ?? '保存失败')
    else await onChanged()
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

  return (
    <div className="section">
      <div className="card">
        <h2>客户端接入</h2>
        <p className="hint">点地址即可复制，token 见下方卡片。</p>
        <dl className="kv kv-wide">
          <dt>本机地址</dt>
          <dd>
            <span className="copy-text mono" onClick={() => void copy(snapshotUrl('127.0.0.1', config.settings.port))}>
              {snapshotUrl('127.0.0.1', config.settings.port)}
            </span>
          </dd>
          <dt>监听端口</dt>
          <dd>
            <div className="row nowrap" style={{ gap: 8 }}>
              <input
                type="number"
                className="w-sm"
                value={port}
                min={1024}
                max={65535}
                onChange={(e) => setPort(e.target.value)}
                onBlur={() => {
                  const value = Math.min(65535, Math.max(1024, Math.round(Number(port) || config.settings.port)))
                  setPort(String(value))
                  if (value !== config.settings.port) void patch({ port: value })
                }}
              />
            </div>
          </dd>
          {config.settings.allowLan ? (
            <>
              <dt>局域网地址</dt>
              <dd>
                <span className="copy-text mono" onClick={() => void copy(snapshotUrl(config.settings.lanIp, config.settings.port))}>
                  {snapshotUrl(config.settings.lanIp, config.settings.port)}
                </span>
              </dd>
            </>
          ) : null}
        </dl>
        <label className="row nowrap mt" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={config.settings.allowLan}
            onChange={(e) => void patch({ allowLan: e.target.checked })}
          />
          <span>允许局域网访问（绑 0.0.0.0）</span>
        </label>
      </div>

      <div className="card">
        <h2>接入 Token</h2>
        <p className="hint">不同客户端用不同 token，备注必填，分析页可按备注分组。</p>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            className="grow"
            value={remark}
            placeholder="备注，例如：笔记本 / 脚本 / 某项目"
            onChange={(e) => setRemark(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
          <button className="btn primary" disabled={busy} onClick={() => void create()}>
            生成 Token
          </button>
        </div>

        <table className="tbl tbl-left mt col-fixed">
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
    </div>
  )
}

function snapshotUrl(host: string, port: number): string {
  return `http://${host}:${port}`
}
