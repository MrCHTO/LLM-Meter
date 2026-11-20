import { useState } from 'react'
import type { ConfigView } from '../../shared/types'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

export function SettingsView({ config, notify, onChanged }: Props): JSX.Element {
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
    <div className="section settings-cards">
      <div className="card">
        <h2>外观</h2>
        <label className="setting-row">
          <span>主题</span>
          <select
            value={config.settings.theme}
            onChange={(e) => void patch({ theme: e.target.value as 'light' | 'dark' | 'system' })}
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h2>悬浮窗</h2>
        <div className="setting-row">
          <span>当前模型</span>
          <span className="muted">
            {config.settings.overlay.global ? '全局（全部模型）' : overlayModel ? overlayModel.alias : '未选择'}
          </span>
        </div>
        <div className="setting-row">
          <span>显示状态</span>
          <button
            className="btn sm"
            onClick={async () => {
              const next = !config.settings.overlay.visible
              await patch({ overlayVisible: next })
              notify(next ? '已显示' : '已隐藏', 'ok')
            }}
          >
            {config.settings.overlay.visible ? '隐藏悬浮窗' : '显示悬浮窗'}
          </button>
        </div>
        <div className="setting-row">
          <span>锁定位置</span>
          <input
            type="checkbox"
            checked={config.settings.overlay.locked}
            onChange={(e) => void patch({ overlayLocked: e.target.checked })}
          />
        </div>
        <label className="setting-row">
          <span>显示供应商名称</span>
          <input
            type="checkbox"
            checked={config.settings.overlay.showProvider}
            onChange={(e) => void patch({ overlayShowProvider: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>显示模型名称</span>
          <input
            type="checkbox"
            checked={config.settings.overlay.showModel}
            onChange={(e) => void patch({ overlayShowModel: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>显示费用</span>
          <input
            type="checkbox"
            checked={config.settings.overlay.showCost}
            onChange={(e) => void patch({ overlayShowCost: e.target.checked })}
          />
        </label>
        <div className="setting-row">
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
            <button className="btn sm" onClick={() => void applyOpacity()}>
              应用
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>启动</h2>
        <label className="setting-row">
          <span>开机自启</span>
          <input
            type="checkbox"
            checked={config.settings.startAtLogin}
            onChange={(e) => {
              const on = e.target.checked
              // 开机自启时顺手勾上只留托盘，避免开机弹窗
              void patch(on ? { startAtLogin: true, startMinimized: true } : { startAtLogin: false })
            }}
          />
        </label>
        <label className="setting-row">
          <span>启动时只留托盘</span>
          <input
            type="checkbox"
            checked={config.settings.startMinimized}
            onChange={(e) => void patch({ startMinimized: e.target.checked })}
          />
        </label>
      </div>

      <div className="card">
        <h2>探针与校准</h2>
        <div className="setting-row">
          <span>自动探针间隔 / 秒（60–3600）</span>
          <div className="row nowrap">
            <input
              className="mono w-sm"
              type="number"
              value={probeInterval}
              onChange={(e) => setProbeInterval(e.target.value)}
            />
            <button
              className="btn sm"
              onClick={async () => {
                const value = Math.min(3600, Math.max(60, Math.round(Number(probeInterval) || 300)))
                setProbeInterval(String(value))
                await patch({ autoProbeIntervalSec: value })
              }}
            >
              应用
            </button>
          </div>
        </div>
        <label className="setting-row">
          <span>启动与每天 00:00 自动校准汇率和自动价</span>
          <input
            type="checkbox"
            checked={config.settings.autoCalibrate}
            onChange={(e) => void patch({ autoCalibrate: e.target.checked })}
          />
        </label>
      </div>

      <div className="card">
        <h2>数据</h2>
        <div className="setting-row">
          <span>数据目录</span>
          <span className="mono selectable">{config.dataDir}</span>
        </div>
        <div className="setting-row">
          <span>软件</span>
          <span className="mono">
            LLM Meter {config.version}
          </span>
        </div>
        <div className="setting-row">
          <span>明细保留天数</span>
          <div className="row nowrap">
            <input
              className="mono w-sm"
              type="number"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            <button
              className="btn sm"
              onClick={async () => {
                await patch({ retentionDays: Number(retention) || 30 })
                await window.api.cleanupEvents()
                notify('保留期已更新', 'ok')
              }}
            >
              应用
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span>维护</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => void window.api.openDataDir()}>
              打开目录
            </button>
            <button
              className="btn sm"
              onClick={async () => {
                const res = await window.api.backup()
                notify(res.ok ? `已备份到 ${res.data}` : (res.error ?? '备份失败'), res.ok ? 'ok' : 'bad')
              }}
            >
              备份配置
            </button>
            <button
              className="btn sm"
              onClick={async () => {
                const res = await window.api.exportDaily()
                notify(res.ok ? `已清理 ${res.data ?? 0} 条过期明细` : (res.error ?? '清理失败'), res.ok ? 'ok' : 'bad')
              }}
            >
              清理过期数据
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
