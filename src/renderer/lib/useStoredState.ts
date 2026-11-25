import { useState } from 'react'

/**
 * 跨页面切换保留的界面选择：值写进 localStorage，切走再回来仍是上次选项。
 * 旧值解析失败时回落到默认值，不影响页面渲染。
 */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const storageKey = `ui:${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  })

  const set = (next: T): void => {
    setValue(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* 写入失败保留内存值即可 */
    }
  }

  return [value, set]
}
