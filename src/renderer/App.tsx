import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfigView, LiveSnapshot } from '../shared/types'
import { Analysis } from './components/Analysis'
import { Access } from './components/Access'
import { Dashboard } from './components/Dashboard'
import { Logs } from './components/Logs'
import { Models } from './components/Models'
import { SettingsView } from './components/Settings'
import { Toasts, type ToastItem } from './components/Toasts'

type Tab = 'dash' | 'analysis' | 'models' | 'access' | 'logs' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dash', label: '仪表盘' },
  { id: 'analysis', label: '分析' },
  { id: 'models', label: '模型与供应商' },
  { id: 'access', label: '接入' },
  { id: 'logs', label: '日志' },
  { id: 'settings', label: '设置' }
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('dash')
  const [config, setConfig] = useState<ConfigView | null>(null)
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [logModel, setLogModel] = useState<string | null>(null)
  const seq = useRef(0)

  const notify = useCallback((text: string, kind: ToastItem['kind'] = 'bad') => {
    const id = ++seq.current
    setToasts((list) => [...list, { id, text, kind }])
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, kind === 'bad' ? 5200 : 2600)
  }, [])

  const reload = useCallback(async () => {
    const res = await window.api.config()
    if (res.ok && res.data) setConfig(res.data)
    else if (res.error) notify(res.error)
  }, [notify])

  useEffect(() => {
    void reload()
    const off = window.api.onPush((snap) => setSnapshot(snap))
    const offCal = window.api.onCalibrated((r) => {
      notify(`自动校准完成：汇率 ${r.rate}，更新 ${r.updated} 个 / 未匹配 ${r.missed} 个`)
      void reload()
    })
    return () => {
      off()
      offCal()
    }
  }, [reload, notify])

  useEffect(() => {
    if (config) document.title = `LLM Meter ${config.version}`
  }, [config])

  if (!config) {
    return <div className="empty">加载中…</div>
  }

  const running = snapshot?.proxyRunning ?? false

  return (
    <div className="shell">
      <header className="topbar">
        <div className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              className="tab"
              aria-selected={tab === item.id}
              onClick={() => {
                if (item.id === 'logs') setLogModel(null)
                setTab(item.id)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="status">
          <span className={`dot ${running ? 'on' : 'off'}`} />
          {running ? null : <span>{snapshot?.proxyError ?? '代理未启动'}</span>}
        </div>
      </header>

      <main className="content">
        {tab === 'dash' && (
          <Dashboard
            snapshot={snapshot}
            config={config}
            notify={notify}
            onChanged={reload}
            onOpenLogs={(modelId) => {
              setLogModel(modelId)
              setTab('logs')
            }}
          />
        )}
        {tab === 'analysis' && <Analysis config={config} notify={notify} />}
        {tab === 'models' && <Models config={config} snapshot={snapshot} notify={notify} onChanged={reload} />}
        {tab === 'access' && <Access config={config} notify={notify} onChanged={reload} />}
        {tab === 'logs' && <Logs config={config} notify={notify} initialModelId={logModel} />}
        {tab === 'settings' && (
          <SettingsView config={config} notify={notify} onChanged={reload} />
        )}
      </main>

      <Toasts items={toasts} />
    </div>
  )
}
