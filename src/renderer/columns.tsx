import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'

type ColWidth = number | 'auto'
interface ColState {
  auto: boolean
  widths: ColWidth[]
}

const MIN_WIDTH = 40
const MAX_WIDTH = 640
const clampWidth = (value: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))

/** 本次运行内的列宽记录：切页面保留，重载或重启后清空复位 */
const store = new Map<string, ColState>()

/**
 * 表格列宽：默认按内容自动排布；拖动表头右缘时把当前实际宽度定格并记住，
 * 双击单个分隔条恢复该列自动，右键表头弹菜单恢复整表自动。记录只活到本次运行。
 */
export function useColumnWidths(
  key: string,
  defaults: number[]
): {
  fixed: boolean
  colgroup: JSX.Element | null
  resizer: (index: number) => JSX.Element
  menu: JSX.Element | null
  tableProps: { onContextMenu: (e: MouseEvent) => void }
} {
  const storageKey = `cols:${key}`
  const [state, setState] = useState<ColState>(
    () => store.get(storageKey) ?? { auto: true, widths: defaults.map(() => 'auto' as ColWidth) }
  )
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const esc = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])

  useEffect(() => {
    store.set(storageKey, state)
  }, [storageKey, state])

  /** 键盘调宽：左右方向键每次 16px，自动态先按当前渲染宽度定格 */
  const resizeBy =
    (index: number) =>
    (event: KeyboardEvent<HTMLElement>): void => {
      const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
      if (step === 0) return
      event.preventDefault()
      const table = (event.currentTarget as HTMLElement).closest('table')
      if (!table) return
      const cells = Array.from(table.querySelectorAll('thead th'))
      setState((current) => {
        const widths: ColWidth[] = current.auto
          ? cells.map((th) => Math.round(th.getBoundingClientRect().width))
          : [...current.widths]
        const picked = widths[index]
        const start = typeof picked === 'number' ? picked : 80
        return { auto: false, widths: widths.map((w, i) => (i === index ? clampWidth(start + step) : w)) }
      })
    }

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
      const apply = (next: number): ColWidth[] => snapshot.map((w, i) => (i === index ? clampWidth(next) : w))
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
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整第 ${index + 1} 列宽度`}
        tabIndex={0}
        className="col-resize"
        title="拖动或按左右方向键调列宽，双击恢复本列自动"
        onMouseDown={startResize(index)}
        onKeyDown={resizeBy(index)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          resetColumn(index)
        }}
      />
    ),
    menu: menu ? (
      <div
        className="ctxmenu"
        style={{
          left: Math.min(menu.x, window.innerWidth - 150),
          top: Math.min(menu.y, window.innerHeight - 50)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            setMenu(null)
            resetAll()
          }}
        >
          自动适应列宽
        </button>
      </div>
    ) : null,
    tableProps: {
      onContextMenu: (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('thead')) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }
    }
  }
}
