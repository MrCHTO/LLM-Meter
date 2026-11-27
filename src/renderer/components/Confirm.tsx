import { useState } from 'react'

interface Props {
  message: string | null
  onCancel: () => void
  onOk: () => void
}

/** 应用内确认框，替代阻塞式 window.confirm */
export function Confirm({ message, onOk, onCancel }: Props): JSX.Element | null {
  if (!message) return null
  return (
    <div className="mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{message}</h3>
        <div className="actions">
          <button className="btn sm" onClick={onCancel}>
            取消
          </button>
          <button className="btn sm" onClick={onOk}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

/** 用状态驱动的确认流程：ask() 返回 Promise<boolean> */
export function useConfirm(): {
  ask: (message: string) => Promise<boolean>
  confirmProps: Props
} {
  const [pending, setPending] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null)

  const ask = (message: string): Promise<boolean> =>
    new Promise((resolve) => {
      setPending({ message, resolve })
    })

  const settle = (ok: boolean): void => {
    pending?.resolve(ok)
    setPending(null)
  }

  return {
    ask,
    confirmProps: {
      message: pending?.message ?? null,
      onOk: () => settle(true),
      onCancel: () => settle(false)
    }
  }
}
