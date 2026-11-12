import { useRef, useState } from 'react'
import type { ConfigView, LiveSnapshot } from '../../shared/types'
import { FORMAT_LABEL, FORMAT_MOUNT } from '../../shared/types'

interface Props {
  config: ConfigView
  snapshot: LiveSnapshot | null
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

export function SettingsView({ config, snapshot, notify, onChanged }: Props): JSX.Element {
  const [showToken, setShowToken] = useState(false)
  const [port, setPort] = useState(String(config.settings.port))
  const [opacity, setOpacity] = useState(config.settings.overlayOpacity)
  const [retention, setRetention] = useState(String(config.settings.retentionDays))
  const tokenRef = useRef<HTMLInputElement>(null)

  const patch = async (values: Parameters<typeof window.api.updateSettings>[0]): Promise<void> => {
    const res = await window.api.updateSettings(values)
    if (!res.ok) notify(res.error ?? '保存失败')
    else await onChanged()
  }

  const copyToken = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(config.settings.localToken)
      notify('token 已复制', 'ok')
    } catch {
      tokenRef.current?.select()
      document.execCommand('copy')
      notify('已复制（回退方式）', 'ok')
    }
  }

  const base = snapshot?.baseUrl || `http://127.0.0.1:${config.settings.port}`

  return (
    <div className="section">
      <div className="card">
        <h2>客户端接入</h2>
        <p className="hint">
          把客户端的 Base URL 指向下面地址，API Key 填本地 token，model 填模型别名。真实上游 Key 不会发到客户端。
        </p>
        <div className="kv">
          <dt>OpenAI 兼容</dt>
          <dd>{base}{FORMAT_MOUNT.openai}/v1</dd>
          <dt>Anthropic</dt>
          <dd>{base}{FORMAT_MOUNT.anthropic}</dd>
          <dt>本地 token</dt>
          <dd>
            <div className="row">
              <input
                ref={tokenRef}
                className="mono"
                type="text"
                readOnly
                value={showToken ? config.settings.localToken : config.settings.localTokenMasked}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn sm" onClick={() => setShowToken((v) => !v)}>
                {showToken ? '隐藏' : '显示'}
              </button>
              <button className="btn sm" onClick={() => void copyToken()}>
                复制
              </button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (!confirm('重签会让现有客户端全部失效，继续？')) return
                  const res = await window.api.rotateToken()
                  if (res.ok) {
                    notify('token 已重签，记得更新客户端', 'ok')
                    await onChanged()
                  } else notify(res.error ?? '重签失败')
                }}
              >
                重签
              </button>
            </div>
          </dd>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className={`dot ${snapshot?.proxyRunning ? 'on' : 'off'}`} />
          <span className="hint" style={{ margin: 0 }}>
            {snapshot?.proxyRunning ? '代理运行中' : (snapshot?.proxyError ?? '代理已停止')}
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              const res = await window.api.restartProxy()
              if (res.ok) notify('代理已重启', 'ok')
              else notify(res.error ?? '重启失败')
              await onChanged()
            }}
          >
            重启代理
          </button>
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <label className="field">
            <span>监听端口</span>
            <div className="row">
              <input className="mono" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
              <button
                className="btn"
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
          </label>
          <label className="field">
            <span>明细保留天数</span>
            <div className="row">
              <input className="mono" type="number" value={retention} onChange={(e) => setRetention(e.target.value)} />
              <button
                className="btn"
                onClick={async () => {
                  await patch({ retentionDays: Number(retention) || 30 })
                  await window.api.cleanupEvents()
                  notify('保留期已更新', 'ok')
                }}
              >
                应用
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>悬浮窗</h2>
        <p className="hint">只显示勾了「在悬浮窗显示」的模型。拖动面板移动，双击打开主窗，右键出菜单。</p>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const next = !config.settings.overlay.visible
              await patch({ overlayVisible: next })
              notify(next ? '已显示' : '已隐藏', 'ok')
            }}
          >
            {config.settings.overlay.visible ? '隐藏悬浮窗' : '显示悬浮窗'}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            没有勾选模型时悬浮窗会显示空态。
          </span>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>不透明度 {opacity}%（鼠标悬停时会临时全不透明）</span>
          <input
            type="range"
            min={30}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            onMouseUp={() => void patch({ overlayOpacity: opacity })}
            onKeyUp={() => void patch({ overlayOpacity: opacity })}
          />
        </label>
        <label className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={config.settings.startMinimized}
            onChange={(e) => void patch({ startMinimized: e.target.checked })}
          />
          <span>启动时只留托盘，不弹主窗</span>
        </label>
      </div>

      <div className="card">
        <h2>数据</h2>
        <p className="hint">全部落在本机文件里：config.json 是配置，events 是逐条明细，rollup 是分钟聚合。</p>
        <div className="kv">
          <dt>数据目录</dt>
          <dd>{config.dataDir}</dd>
          <dt>版本</dt>
          <dd>{config.version}</dd>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => void window.api.openDataDir()}>
            打开目录
          </button>
          <button
            className="btn"
            onClick={async () => {
              const res = await window.api.backup()
              notify(res.ok ? `已备份到 ${res.data}` : (res.error ?? '备份失败'), res.ok ? 'ok' : 'bad')
            }}
          >
            备份配置
          </button>
          <button
            className="btn"
            onClick={async () => {
              const res = await window.api.exportDaily()
              notify(res.ok ? '聚合已落盘，可在 rollup 目录取用' : (res.error ?? '导出失败'), res.ok ? 'ok' : 'bad')
            }}
          >
            立即落盘聚合
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          明细 {config.settings.retentionDays} 天、聚合 {config.settings.rollupRetentionDays} 天后自动删除。当前格式：
          {config.providers.map((p) => `${p.name}=${FORMAT_LABEL[p.format]}`).join('，') || '—'}
        </p>
      </div>
    </div>
  )
}
