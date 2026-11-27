export interface ToastItem {
  id: number
  text: string
  kind: 'ok' | 'bad'
}

export function Toasts({ items }: { items: ToastItem[] }): JSX.Element {
  return (
    <div className="toasts">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          {item.text}
        </div>
      ))}
    </div>
  )
}
