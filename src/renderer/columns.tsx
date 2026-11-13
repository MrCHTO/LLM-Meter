import { useEffect, useState, type MouseEvent } from 'react'

/**
 * 表格列宽：localStorage 按表名记住，拖动表头右缘调整，双击恢复默认。
 * 只在前端持久化，不写配置，重启窗口后仍在。
 */
export function useColumnWidths(key: string, defaults: number[]): {
  widths: number[]
  colgroup: JSX.Element
  resizer: (index: number) => JSX.Element
} {
  const storageKey = `cols:${key}`
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return defaults
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed) || parsed.length !== defaults.length) return defaults
      return parsed.map((n, i) => (Number.isFinite(n) && Number(n) >= 40 ? Number(n) : (defaults[i] as number)))
    } catch {
      return defaults
    }
  })

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths))
  }, [storageKey, widths])

  const startResize = (index: number) => (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widths[index] ?? 80
    document.body.classList.add('col-resizing')

    const move = (e: globalThis.MouseEvent): void => {
      const next = Math.min(640, Math.max(40, startWidth + (e.clientX - startX)))
      setWidths((current) => current.map((w, i) => (i === index ? next : w)))
    }
    const up = (): void => {
      document.body.classList.remove('col-resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const reset = (index: number): void => {
    setWidths((current) => current.map((w, i) => (i === index ? (defaults[index] as number) : w)))
  }

  return {
    widths,
    colgroup: (
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
    ),
    resizer: (index: number) => (
      <span
        className="col-resize"
        title="拖动调列宽，双击恢复"
        onMouseDown={startResize(index)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          reset(index)
        }}
      />
    )
  }
}
