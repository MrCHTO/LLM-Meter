import { useState } from 'react'
import type { ConfigView } from '../../shared/types'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

type Group = 'overlay' | 'run' | 'data'

const GROUPS: { id: Group; label: string }[] = [
  { id: 'overlay', label: '悬浮窗' },
  { id: 'run', label: '运行' },
  { id: 'data', label: '数据' }
]

export function SettingsView({ config, notify, onChanged }: Props): JSX.Element {
  const [group, setGroup] = useState<Group>('overlay')
  const [opacity, setOpacity] = useState<string>(String(config.settings.overlayOpacity))
  const [retention, setRetention] = useState(String(config.settings.retentionDays))
  const [probeInterval, setProbeInterval] = useState(String(config.settings.autoProbeIntervalSec))

  const patch = async (values: Parameters<typeof window.api.updateSettings>[0]): Promise<void> => {
    const res = await window.api.updateSettings(values)
    if (!res.ok) notify(res.error ?? '保存失败')
    else await onChanged()
  }

  const applyOpacity = async (): Promise<void> => {
    const value = Math.min(100, Math.max(10, Math.round(Number(opacity) || 100)))
    setOpacity(String(value))
    await patch({ overlayOpacity: value })
  }

  const overlayModel = config.models.find((m) => m.id === config.settings.overlay.modelId)

  return (
    <div className="section">
      <div className="settings-split">
        <nav className="settings-nav">
          {GROUPS.map((g) => (
            <button key={g.id} className={group === g.id ? 'active' : ''} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </nav>

        <div className="settings-pane">
          {group === 'overlay' ? (
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
                <span>不透明度（10–100）</span>
                <div className="row nowrap">
                  <input
                    className="mono w-sm"
                    type="number"
                    min={10}
                    max={100}
                    value={opacity}
                    onChange={(e) => setOpacity(e.target.value)}
                    onKeyUp={(e) => {
                      if (e.key === 'Enter') void applyOpacity()
                    }}
                  />
                  <button className="btn" onClick={() => void applyOpacity()}>
                    应用
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {group === 'run' ? (
            <div className="card">
              <h2>运行</h2>
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
              <label className="row nowrap mt" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={config.settings.startAtLogin}
                  onChange={(e) => {
                    const on = e.target.checked
                    // 开机自启时顺手勾上只留托盘，避免开机弹窗；可再手动取消
                    void patch(on ? { startAtLogin: true, startMinimized: true } : { startAtLogin: false })
                  }}
                />
                <span>开机自启</span>
                <span className="muted">若未生效，检查安全软件的启动项拦截</span>
              </label>
              <label className="field mt">
                <span>自动探针间隔 / 秒（60–3600，每个开启探针的模型各算各的）</span>
                <div className="row nowrap">
                  <input
                    className="mono w-sm"
                    type="number"
                    value={probeInterval}
                    onChange={(e) => setProbeInterval(e.target.value)}
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      const value = Math.min(3600, Math.max(60, Math.round(Number(probeInterval) || 300)))
                      setProbeInterval(String(value))
                      await patch({ autoProbeIntervalSec: value })
                    }}
                  >
                    应用
                  </button>
                </div>
              </label>
              <label className="row nowrap mt" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={config.settings.autoCalibrate}
                  onChange={(e) => void patch({ autoCalibrate: e.target.checked })}
                />
                <span>启动与每天 00:00 自动校准汇率和自动价（手动价不动，过程见日志页）</span>
              </label>
            </div>
          ) : null}

          {group === 'data' ? (
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
          ) : null}
        </div>
      </div>
    </div>
  )
}
