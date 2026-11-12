import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfigView, LiveSnapshot } from '../shared/types'
import { Analysis } from './components/Analysis'
import { Dashboard } from './components/Dashboard'
import { Models } from './components/Models'
import { SettingsView } from './components/Settings'
import { Toasts, type ToastItem } from './components/Toasts'

type Tab = 'dash' | 'analysis' | 'models' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dash', label: '仪表盘' },
  { id: 'analysis', label: '分析' },
  { id: 'models', label: '模型与供应商' },
  { id: 'settings', label: '设置' }
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('dash')
  const [config, setConfig] = useState<ConfigView | null>(null)
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
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
    return off
  }, [reload])

  useEffect(() => {
    document.title = 'LLM Meter'
  }, [])

  if (!config) {
    return <div className="empty">加载中…</div>
  }

  const running = snapshot?.proxyRunning ?? false
  const enabledModels = config.models.filter((m) => m.enabled).length

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          LLM Meter<small>本地计量</small>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              className="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="status">
          <span className={`dot ${running ? 'on' : 'off'}`} />
          <span>{running ? `监听 ${snapshot?.baseUrl ?? ''}` : (snapshot?.proxyError ?? '代理未启动')}</span>
          <span className="pill">{enabledModels} 个模型启用</span>
        </div>
      </header>

      <main className="content">
        {tab === 'dash' && (
          <Dashboard snapshot={snapshot} config={config} notify={notify} onChanged={reload} />
        )}
        {tab === 'analysis' && <Analysis config={config} notify={notify} />}
        {tab === 'models' && <Models config={config} notify={notify} onChanged={reload} />}
        {tab === 'settings' && (
          <SettingsView config={config} snapshot={snapshot} notify={notify} onChanged={reload} />
        )}
      </main>

      <Toasts items={toasts} />
    </div>
  )
}
