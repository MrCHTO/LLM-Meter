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
  const [rate, setRate] = useState(String(config.settings.usdCny))
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

  const overlayModel = config.models.find((m) => m.id === config.settings.overlay.modelId)
  const localBase = `http://127.0.0.1:${config.settings.port}`
  const lanBase = `http://${config.settings.lanIp}:${config.settings.port}`
  const lanOn = config.settings.allowLan

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      notify(`${label} 已复制`, 'ok')
    } catch {
      notify('复制失败，请手动选中', 'bad')
    }
  }

  return (
    <div className="section">
      <div className="card">
        <h2>客户端接入</h2>
        <dl className="kv kv-wide">
          <dt>本机 · OpenAI</dt>
          <dd>
            <div className="row nowrap">
              <span className="mono selectable grow ellipsis">
                {localBase}{FORMAT_MOUNT.openai}/v1
              </span>
              <button className="btn sm" onClick={() => void copy(`${localBase}${FORMAT_MOUNT.openai}/v1`, '本机地址')}>
                复制
              </button>
            </div>
          </dd>
          <dt>本机 · Anthropic</dt>
          <dd>
            <div className="row nowrap">
              <span className="mono selectable grow ellipsis">
                {localBase}{FORMAT_MOUNT.anthropic}
              </span>
              <button className="btn sm" onClick={() => void copy(`${localBase}${FORMAT_MOUNT.anthropic}`, '本机地址')}>
                复制
              </button>
            </div>
          </dd>
          <dt>局域网 · OpenAI</dt>
          <dd className={lanOn ? undefined : 'dimmed'}>
            <div className="row nowrap">
              <span className="mono selectable grow ellipsis">
                {lanBase}{FORMAT_MOUNT.openai}/v1
              </span>
              <button
                className="btn sm"
                disabled={!lanOn}
                onClick={() => void copy(`${lanBase}${FORMAT_MOUNT.openai}/v1`, '局域网地址')}
              >
                复制
              </button>
            </div>
          </dd>
          <dt>本地 token</dt>
          <dd>
            <div className="row nowrap">
              <input
                ref={tokenRef}
                className="mono grow"
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
        </dl>

        <div className="divider" />

        <div className="row">
          <label className="row nowrap" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={lanOn}
              onChange={(e) => void patch({ allowLan: e.target.checked })}
            />
            <span>允许局域网访问</span>
          </label>
          <span className="muted">
            {lanOn ? '同网段拿到 token 即可使用你的额度' : '默认只监听 127.0.0.1'}
          </span>
        </div>

        <div className="divider" />

        <div className="row">
          <span className={`dot ${snapshot?.proxyRunning ? 'on' : 'off'}`} />
          <span className="muted">
            {snapshot?.proxyRunning ? '代理运行中' : (snapshot?.proxyError ?? '代理已停止')}
          </span>
          <button
            className="btn sm"
            style={{ marginLeft: 'auto' }}
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
      </div>

      <div className="card">
        <h2>运行</h2>
        <div className="grid-2">
          <label className="field">
            <span>监听端口</span>
            <div className="row nowrap">
              <input className="mono w-sm" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
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
            <div className="row nowrap">
              <input
                className="mono w-sm"
                type="number"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
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
        <label className="row nowrap mt" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={config.settings.pauseProbe}
            onChange={(e) => void patch({ pauseProbe: e.target.checked })}
          />
          <span>暂停测速（悬浮窗与仪表盘仍照常记录真实流量）</span>
        </label>
        <div className="field mt">
          <span>美元换人民币汇率{config.settings.usdCnyDate ? ` · ${config.settings.usdCnyDate} 自动` : ' · 未取到'}</span>
          <div className="row nowrap">
            <input
              className="mono w-sm"
              type="number"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <button
              className="btn"
              onClick={async () => {
                const value = Number(rate)
                if (!value || value < 1 || value > 20) {
                  notify('汇率需要在 1-20 之间')
                  return
                }
                await patch({ usdCny: value })
                notify(`汇率已设为 ¥${value}/$`, 'ok')
              }}
            >
              应用
            </button>
            <button
              className="btn"
              onClick={async () => {
                const res = await window.api.refreshRate()
                if (!res.ok || !res.data) {
                  notify(res.error ?? '取汇率失败，沿用旧值')
                } else {
                  setRate(String(res.data.rate))
                  notify(`已更新为 ¥${res.data.rate}/$（${res.data.date}）`, 'ok')
                }
                await onChanged()
              }}
            >
              取当天
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>悬浮窗</h2>
        <dl className="kv kv-wide">
          <dt>当前模型</dt>
          <dd>{overlayModel ? overlayModel.alias : '未选择（在模型列表里点「选中」或右键胶囊选择）'}</dd>
        </dl>
        <div className="divider" />
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
          <label className="row nowrap" style={{ gap: 8, marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={config.settings.startMinimized}
              onChange={(e) => void patch({ startMinimized: e.target.checked })}
            />
            <span className="muted">启动时只留托盘</span>
          </label>
        </div>
        <div className="field mt">
          <span className="row">
            <span>不透明度</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>{opacity}%</span>
          </span>
          <input
            type="range"
            min={10}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            onMouseUp={() => void patch({ overlayOpacity: opacity })}
            onKeyUp={() => void patch({ overlayOpacity: opacity })}
          />
        </div>
      </div>

      <div className="card">
        <h2>数据</h2>
        <dl className="kv kv-wide">
          <dt>数据目录</dt>
          <dd className="mono selectable">{config.dataDir}</dd>
          <dt>软件</dt>
          <dd>
            LLM Meter <span className="mono">{config.version}</span>
          </dd>
        </dl>
        <div className="divider" />
        <div className="row">
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
              notify(res.ok ? `已清理 ${res.data ?? 0} 条过期明细` : (res.error ?? '清理失败'), res.ok ? 'ok' : 'bad')
            }}
          >
            清理过期数据
          </button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            明细 {config.settings.retentionDays} 天 / 分钟聚合 {config.settings.rollupRetentionDays} 天 / 日聚合永久
          </span>
        </div>
      </div>
    </div>
  )
}
