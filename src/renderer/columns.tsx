import { useEffect, useState, type MouseEvent } from 'react'

type ColWidth = number | 'auto'
interface ColState {
  auto: boolean
  widths: ColWidth[]
}

/**
 * 表格列宽：默认按内容自动排布；拖动表头右缘时把当前实际宽度定格并记住，
 * 双击单个分隔条恢复该列自动，右键表头恢复整表自动并清掉记录。
 */
export function useColumnWidths(
  key: string,
  defaults: number[]
): {
  fixed: boolean
  colgroup: JSX.Element | null
  resizer: (index: number) => JSX.Element
  tableProps: { onContextMenu: (e: MouseEvent) => void }
} {
  const storageKey = `cols:${key}`
  const [state, setState] = useState<ColState>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { auto: true, widths: defaults.map(() => 'auto' as ColWidth) }
      const parsed = JSON.parse(raw) as unknown
      // 旧格式：纯数字数组，视为已手动固定
      if (Array.isArray(parsed) && parsed.length === defaults.length) {
        return {
          auto: false,
          widths: parsed.map((n, i) => (Number.isFinite(n) && Number(n) >= 40 ? Number(n) : (defaults[i] as number)))
        }
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as { auto?: unknown; widths?: unknown }
        if (Array.isArray(obj.widths) && obj.widths.length === defaults.length) {
          return {
            auto: obj.auto !== false,
            widths: obj.widths.map((w) =>
              w === 'auto' || typeof w !== 'number' || !Number.isFinite(w) ? 'auto' : Math.max(40, w)
            )
          }
        }
      }
      return { auto: true, widths: defaults.map(() => 'auto' as ColWidth) }
    } catch {
      return { auto: true, widths: defaults.map(() => 'auto' as ColWidth) }
    }
  })

  useEffect(() => {
    if (state.auto) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, JSON.stringify(state))
  }, [storageKey, state])

  /** 自动态下拖动：按当前渲染宽度定格所有列，再开始改这一列 */
  const startResize =
    (index: number) =>
    (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const table = (event.currentTarget as HTMLElement).closest('table')
      if (!table) return
      const cells = Array.from(table.querySelectorAll('thead th'))
      const snapshot: ColWidth[] = cells.map((th) => Math.round(th.getBoundingClientRect().width))
      const startX = event.clientX
      const picked = snapshot[index]
      const startWidth = typeof picked === 'number' ? picked : 80
      const apply = (next: number): ColWidth[] =>
        snapshot.map((w, i) => (i === index ? Math.min(640, Math.max(40, next)) : w))
      setState({ auto: false, widths: apply(startWidth) })
      document.body.classList.add('col-resizing')

      const move = (e: globalThis.MouseEvent): void => {
        setState({ auto: false, widths: apply(startWidth + (e.clientX - startX)) })
      }
      const up = (): void => {
        document.body.classList.remove('col-resizing')
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }

  const resetColumn = (index: number): void => {
    setState((current) => {
      if (current.auto) return current
      const widths = current.widths.map((w, i) => (i === index ? 'auto' : w))
      return { auto: widths.every((w) => w === 'auto'), widths }
    })
  }

  const resetAll = (): void => {
    setState({ auto: true, widths: defaults.map(() => 'auto' as ColWidth) })
  }

  return {
    fixed: !state.auto,
    colgroup: state.auto ? null : (
      <colgroup>
        {state.widths.map((w, i) => (
          <col key={i} style={w === 'auto' ? undefined : { width: w }} />
        ))}
      </colgroup>
    ),
    resizer: (index: number) => (
      <span
        className="col-resize"
        title="拖动调列宽，双击恢复本列自动"
        onMouseDown={startResize(index)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          resetColumn(index)
        }}
      />
    ),
    tableProps: {
      onContextMenu: (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('thead')) return
        e.preventDefault()
        resetAll()
      }
    }
  }
}
