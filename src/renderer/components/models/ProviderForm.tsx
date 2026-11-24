import type { ApiFormat } from '../../../shared/types'
import type { ProviderDraft } from './drafts'

interface Props {
  draft: ProviderDraft
  busy: boolean
  onChange: (draft: ProviderDraft) => void
  onSave: () => void
  onClose: () => void
}

export function ProviderForm({ draft, busy, onChange, onSave, onClose }: Props): JSX.Element {
  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{draft.id ? '编辑供应商' : '添加供应商'}</h3>
        <div className="section" style={{ gap: 10 }}>
          <label className="field">
            <span>名称（必填）</span>
            <input
              type="text"
              value={draft.name}
              placeholder="例如 我的中转站"
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Base URL</span>
            <input
              type="text"
              className="mono"
              value={draft.baseUrl}
              placeholder="https://relay.example.com"
              onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
            />
          </label>
          <label className="field">
            <span>协议</span>
            <select value={draft.format} onChange={(e) => onChange({ ...draft, format: e.target.value as ApiFormat })}>
              <option value="openai">OpenAI（/v1/chat/completions）</option>
              <option value="anthropic">Anthropic Messages（/v1/messages）</option>
            </select>
          </label>
          <label className="field">
            <span>API Key {draft.id ? '（留空表示不改）' : ''}</span>
            <input
              type="password"
              className="mono"
              value={draft.apiKey}
              placeholder="sk-..."
              onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
            />
          </label>
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
