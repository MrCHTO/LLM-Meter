import { useState } from 'react'
import { useApp, useConfig } from '../state/AppState'

import { LIMITS, clampInt } from '../../shared/limits'
import { Switch } from './Switch'

export function SettingsView(): JSX.Element {
  const config = useConfig()
  const { notify, reload: onChanged } = useApp()
  const [retention, setRetention] = useState(String(config.settings.retentionDays))
  const [probeInterval, setProbeInterval] = useState(String(config.settings.autoProbeIntervalSec))

  const patch = async (values: Parameters<typeof window.api.updateSettings>[0]): Promise<boolean> => {
    try {
      const res = await window.api.updateSettings(values)
      if (!res.ok) {
        notify(res.error ?? '保存失败')
        return false
      }
      await onChanged()
      return true
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败')
      return false
    }
  }

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
        <h2>启动</h2>
        <div className="setting-row">
          <span>开机自启</span>
          <Switch
            checked={config.settings.startAtLogin}
            onChange={(on) => {
              // 开机自启时顺手打开只留托盘，避免开机弹窗
              void patch(on ? { startAtLogin: true, startMinimized: true } : { startAtLogin: false })
            }}
          />
        </div>
        <div className="setting-row">
          <span>启动时只留托盘</span>
          <Switch checked={config.settings.startMinimized} onChange={(v) => void patch({ startMinimized: v })} />
        </div>
      </div>

      <div className="card">
        <h2>探针与校准</h2>
        <div className="setting-row">
          <span>
            自动探针间隔 / 秒（{LIMITS.autoProbeIntervalSec.min}–{LIMITS.autoProbeIntervalSec.max}）
          </span>
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
                const value = clampInt('autoProbeIntervalSec', Number(probeInterval) || 300)
                setProbeInterval(String(value))
                await patch({ autoProbeIntervalSec: value })
              }}
            >
              应用
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span>启动与每天 00:00 自动校准汇率和自动价</span>
          <Switch checked={config.settings.autoCalibrate} onChange={(v) => void patch({ autoCalibrate: v })} />
        </div>
      </div>

      <div className="card">
        <h2>数据</h2>
        <div className="setting-row">
          <span>数据目录</span>
          <span className="mono selectable">{config.dataDir}</span>
        </div>
        <div className="setting-row">
          <span>软件</span>
          <span className="mono">LLM Meter {config.version}</span>
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
                if (!(await patch({ retentionDays: Number(retention) || 30 }))) return
                const res = await window.api.cleanupEvents()
                notify(res.ok ? '保留期已更新' : (res.error ?? '清理失败'), res.ok ? 'ok' : 'bad')
              }}
            >
              应用
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span>维护</span>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn sm"
              onClick={async () => {
                const res = await window.api.openDataDir()
                if (!res.ok) notify(res.error ?? '打不开目录')
              }}
            >
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
