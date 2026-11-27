interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 悬停说明；不给则按开关状态给默认文案 */
  title?: string
  disabled?: boolean
}

/** 椭圆滑动开关：全软件替代原生勾选框 */
export function Switch({ checked, onChange, title, disabled }: Props): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title ?? (checked ? '已开启' : '已关闭')}
      disabled={disabled}
      className={checked ? 'switch on' : 'switch'}
      onClick={() => onChange(!checked)}
    />
  )
}
