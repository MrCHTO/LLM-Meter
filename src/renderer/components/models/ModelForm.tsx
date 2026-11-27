import { FORMAT_LABEL, type ProviderView } from '../../../shared/types'
import { useApp, useConfig } from '../../state/AppState'
import type { ModelDraft } from './drafts'

interface Props {
  draft: ModelDraft
  providers: ProviderView[]
  busy: boolean
  priceNote: string
  lookedUpFor: string
  writeField: 'unknown' | 'yes' | 'no'
  onChange: (draft: ModelDraft) => void
  onLookup: (name: string) => void
  onPriceNote: (text: string) => void
  onSave: () => void
  onClose: () => void
}

export function ModelForm({
  draft,
  providers,
  busy,
  priceNote,
  lookedUpFor,
  writeField,
  onChange,
  onLookup,
  onPriceNote,
  onSave,
  onClose
}: Props): JSX.Element {
  const config = useConfig()
  const { notify, reload } = useApp()
  const source = draft.id ? config.models.find((x) => x.id === draft.id)?.priceSource : undefined

  const setName = (value: string): void => {
    const follow = !draft.id && (draft.alias === '' || draft.alias === draft.upstreamModel)
    onChange({ ...draft, upstreamModel: value, alias: follow ? value : draft.alias })
    if (priceNote && value.trim() !== lookedUpFor) onPriceNote('模型名已改，点「查价」按新名字重查')
  }

  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{draft.id ? '编辑模型' : '添加模型'}</h3>
        <div className="section" style={{ gap: 10 }}>
          <label className="field">
            <span>供应商</span>
            <select value={draft.providerId} onChange={(e) => onChange({ ...draft, providerId: e.target.value })}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{FORMAT_LABEL[p.format]}）
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>上游模型名</span>
            <div className="row">
              <input
                type="text"
                className="mono"
                value={draft.upstreamModel}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const empty = !draft.priceIn || Number(draft.priceIn) === 0
                  if (empty && draft.upstreamModel.trim()) onLookup(draft.upstreamModel)
                }}
              />
              <button className="btn" onClick={() => onLookup(draft.upstreamModel)}>
                查价
              </button>
            </div>
          </label>
          {priceNote ? <p className="hint">{priceNote}</p> : null}
          <label className="field">
            <span>别名</span>
            <input
              type="text"
              className="mono"
              value={draft.alias}
              placeholder="my-claude"
              onChange={(e) => onChange({ ...draft, alias: e.target.value })}
            />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>输入单价 / 百万 token / ¥</span>
              <input
                type="number"
                step="0.01"
                value={draft.priceIn}
                onChange={(e) => onChange({ ...draft, priceIn: e.target.value })}
              />
            </label>
            <label className="field">
              <span>输出单价 / 百万 token / ¥</span>
              <input
                type="number"
                step="0.01"
                value={draft.priceOut}
                onChange={(e) => onChange({ ...draft, priceOut: e.target.value })}
              />
            </label>
            <label className="field">
              <span>缓存读取单价 / 百万 token / ¥</span>
              <input
                type="number"
                step="0.01"
                value={draft.priceCacheRead}
                onChange={(e) => onChange({ ...draft, priceCacheRead: e.target.value })}
              />
            </label>
            <label className="field">
              <span>缓存输入单价 / 百万 token / ¥</span>
              <input
                type="number"
                step="0.01"
                value={writeField === 'no' ? '' : draft.priceCacheInput}
                placeholder={writeField === 'no' ? '-' : undefined}
                disabled={writeField === 'no'}
                onChange={(e) => onChange({ ...draft, priceCacheInput: e.target.value })}
              />
            </label>
          </div>
          {draft.id ? (
            <div className="row mt" style={{ gap: 8 }}>
              <span className="muted">价格来源：{source === 'manual' ? '手动' : '自动校准'}</span>
              <button
                className="btn sm"
                disabled={source !== 'manual'}
                onClick={async () => {
                  if (!draft.id) return
                  const res = await window.api.updateModel(draft.id, { priceSource: 'auto' })
                  if (!res.ok) notify(res.error ?? '恢复失败')
                  else await reload()
                }}
              >
                恢复自动
              </button>
            </div>
          ) : null}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={busy} onClick={onSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
