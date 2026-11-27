import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConfigView, LiveSnapshot } from '../../shared/types'
import type { ToastItem } from '../components/Toasts'

interface AppStateValue {
  config: ConfigView | null
  snapshot: LiveSnapshot | null
  toasts: ToastItem[]
  notify: (text: string, kind?: ToastItem['kind']) => void
  reload: () => Promise<void>
}

const AppContext = createContext<AppStateValue | null>(null)

/** 全局配置、实时快照与提示：页面从 useApp() 取，不再层层传 props */
export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [config, setConfig] = useState<ConfigView | null>(null)
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const notify = useCallback((text: string, kind: ToastItem['kind'] = 'bad') => {
    const id = ++seq.current
    setToasts((list) => [...list, { id, text, kind }])
    setTimeout(
      () => {
        setToasts((list) => list.filter((t) => t.id !== id))
      },
      kind === 'bad' ? 5200 : 2600
    )
  }, [])

  const reload = useCallback(async () => {
    try {
      const res = await window.api.config()
      if (res.ok && res.data) setConfig(res.data)
      else if (res.error) notify(res.error)
    } catch (err) {
      notify(err instanceof Error ? err.message : '读取配置失败')
    }
  }, [notify])

  useEffect(() => {
    void reload()
    const offPush = window.api.onPush((snap) => setSnapshot(snap))
    const offCal = window.api.onCalibrated((r) => {
      notify(`自动校准完成：汇率 ${r.rate}，更新 ${r.updated} 个 / 未匹配 ${r.missed} 个`)
      void reload()
    })
    return () => {
      offPush()
      offCal()
    }
  }, [reload, notify])

  return <AppContext.Provider value={{ config, snapshot, toasts, notify, reload }}>{children}</AppContext.Provider>
}

/** 配置就绪后的视图：Shell 已经挡住未加载状态 */
export function useConfig(): ConfigView {
  const { config } = useApp()
  if (!config) throw new Error('配置尚未加载')
  return config
}

export function useApp(): AppStateValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp 必须在 AppProvider 内使用')
  return value
}
