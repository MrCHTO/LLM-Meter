import { useEffect, useState } from 'react'
import { Analysis } from './components/Analysis'
import { Access } from './components/Access'
import { Dashboard } from './components/Dashboard'
import { Logs } from './components/Logs'
import { Models } from './components/Models'
import { OverlayView } from './components/Overlay'
import { SettingsView } from './components/Settings'
import { Toasts } from './components/Toasts'
import { AppProvider, useApp } from './state/AppState'

type Tab = 'dash' | 'analysis' | 'models' | 'access' | 'logs' | 'overlay' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dash', label: '仪表盘' },
  { id: 'analysis', label: '分析' },
  { id: 'models', label: '模型与供应商' },
  { id: 'access', label: '接入' },
  { id: 'logs', label: '日志' },
  { id: 'overlay', label: '悬浮窗' },
  { id: 'settings', label: '设置' }
]

function Shell(): JSX.Element {
  const { config, snapshot, toasts } = useApp()
  const [tab, setTab] = useState<Tab>('dash')
  const [logModel, setLogModel] = useState<string | null>(null)

  useEffect(() => {
    if (config) document.title = `LLM Meter ${config.version}`
  }, [config])

  // 主题：system 跟随系统深浅色，变化时即时切换
  useEffect(() => {
    const theme = config?.settings.theme ?? 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (theme !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [config?.settings.theme])

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
        {tab === 'dash' && <Dashboard onOpenLogs={setLogModel} goLogs={() => setTab('logs')} />}
        {tab === 'analysis' && <Analysis />}
        {tab === 'models' && <Models />}
        {tab === 'access' && <Access />}
        {tab === 'logs' && <Logs initialModelId={logModel} />}
        {tab === 'overlay' && <OverlayView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      <Toasts items={toasts} />
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
