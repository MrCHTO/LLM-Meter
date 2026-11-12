import { useState } from 'react'
import type { ApiFormat, ConfigView, ModelCfg, ProviderView } from '../../shared/types'
import { FORMAT_LABEL } from '../../shared/types'
import { fmtMoney } from '../format'

interface Props {
  config: ConfigView
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

const CURRENCIES = ['USD', 'CNY', 'EUR', 'JPY']

interface ProviderDraft {
  id?: string
  name: string
  baseUrl: string
  format: ApiFormat
  apiKey: string
}

const EMPTY_PROVIDER: ProviderDraft = { name: '', baseUrl: '', format: 'openai', apiKey: '' }

interface ModelDraft {
  id?: string
  providerId: string
  upstreamModel: string
  alias: string
  priceIn: string
  priceOut: string
  priceCacheRead: string
  priceCacheWrite: string
  currency: string
  dailyBudget: string
  watch: boolean
}

function emptyModel(providerId: string): ModelDraft {
  return {
    providerId,
    upstreamModel: '',
    alias: '',
    priceIn: '0',
    priceOut: '0',
    priceCacheRead: '0',
    priceCacheWrite: '0',
    currency: 'USD',
    dailyBudget: '',
    watch: true
  }
}

export function Models({ config, notify, onChanged }: Props): JSX.Element {
  const [provider, setProvider] = useState<ProviderDraft | null>(null)
  const [model, setModel] = useState<ModelDraft | null>(null)
  const [busy, setBusy] = useState(false)

  const saveProvider = async (): Promise<void> => {
    if (!provider) return
    if (!provider.baseUrl.trim()) {
      notify('Base URL 不能为空')
      return
    }
    setBusy(true)
    const res = provider.id
      ? await window.api.updateProvider(provider.id, {
          name: provider.name,
          baseUrl: provider.baseUrl,
          format: provider.format,
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {})
        })
      : await window.api.createProvider({
          name: provider.name,
          baseUrl: provider.baseUrl,
          format: provider.format,
          apiKey: provider.apiKey,
          enabled: true
        })
    setBusy(false)
    if (!res.ok) {
      notify(res.error ?? '保存失败')
      return
    }
    setProvider(null)
    notify('供应商已保存', 'ok')
    await onChanged()
  }

  const saveModel = async (): Promise<void> => {
    if (!model) return
    const payload: Omit<ModelCfg, 'id' | 'createdAt' | 'sort'> = {
      providerId: model.providerId,
      upstreamModel: model.upstreamModel,
      alias: model.alias,
      enabled: true,
      watch: model.watch,
      priceIn: Number(model.priceIn) || 0,
      priceOut: Number(model.priceOut) || 0,
      priceCacheRead: Number(model.priceCacheRead) || 0,
      priceCacheWrite: Number(model.priceCacheWrite) || 0,
      currency: model.currency,
      dailyBudget: Number(model.dailyBudget) || null
    }
    setBusy(true)
    const res = model.id
      ? await window.api.updateModel(model.id, payload)
      : await window.api.createModel(payload)
    setBusy(false)
    if (!res.ok) {
      notify(res.error ?? '保存失败')
      return
    }
    setModel(null)
    notify('模型已保存', 'ok')
    await onChanged()
  }

  const test = async (p: ProviderView): Promise<void> => {
    const res = await window.api.testProvider(p.id)
    if (!res.ok) {
      notify(res.error ?? '测试失败')
      return
    }
    notify(`${p.name}：${res.data?.message ?? ''}`, res.data?.ok ? 'ok' : 'bad')
  }

  const providers = config.providers

  return (
    <div className="section">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>供应商</h2>
            <p className="hint">Base URL 填到域名或前缀即可，例如 https://relay.example.com。Key 用 Windows DPAPI 加密后落盘。</p>
          </div>
          <button className="btn primary" onClick={() => setProvider({ ...EMPTY_PROVIDER })}>
            添加供应商
          </button>
        </div>
        {providers.length === 0 ? (
          <div className="empty">还没有供应商</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Base URL</th>
                <th>格式</th>
                <th>Key</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono" style={{ textAlign: 'left' }}>
                    {p.baseUrl}
                  </td>
                  <td>{FORMAT_LABEL[p.format]}</td>
                  <td className="mono">{p.keyMasked}</td>
                  <td>{p.enabled ? <span className="pill ok">启用</span> : <span className="pill">停用</span>}</td>
                  <td>
                    <button className="btn sm" onClick={() => void test(p)}>
                      测试
                    </button>{' '}
                    <button
                      className="btn sm"
                      onClick={() =>
                        setProvider({ id: p.id, name: p.name, baseUrl: p.baseUrl, format: p.format, apiKey: '' })
                      }
                    >
                      编辑
                    </button>{' '}
                    <button
                      className="btn sm"
                      onClick={async () => {
                        if (!confirm(`删除供应商 ${p.name} 及其下所有模型？`)) return
                        const res = await window.api.deleteProvider(p.id)
                        if (!res.ok) notify(res.error ?? '删除失败')
                        else {
                          notify('已删除', 'ok')
                          await onChanged()
                        }
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>模型</h2>
            <p className="hint">
              别名是客户端要填的 model 名，全局唯一；上游模型名是真正发给供应商的名字。单价按每百万 token。
            </p>
          </div>
          <button
            className="btn primary"
            disabled={providers.length === 0}
            onClick={() => setModel(emptyModel(providers[0]?.id ?? ''))}
          >
            添加模型
          </button>
        </div>
        {config.models.length === 0 ? (
          <div className="empty">{providers.length === 0 ? '先添加供应商' : '还没有模型'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>别名</th>
                <th>上游模型</th>
                <th>入/出 单价</th>
                <th>缓存读/写 单价</th>
                <th>日预算</th>
                <th>悬浮窗</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {config.models.map((m) => (
                <tr key={m.id}>
                  <td>{m.alias}</td>
                  <td className="mono" style={{ textAlign: 'left' }}>
                    {m.upstreamModel}
                  </td>
                  <td className="mono">
                    {fmtMoney(m.priceIn, m.currency)} / {fmtMoney(m.priceOut, m.currency)}
                  </td>
                  <td className="mono">
                    {fmtMoney(m.priceCacheRead, m.currency)} / {fmtMoney(m.priceCacheWrite, m.currency)}
                  </td>
                  <td className="mono">{m.dailyBudget ? fmtMoney(m.dailyBudget, m.currency) : '—'}</td>
                  <td>
                    <button
                      className="btn sm ghost"
                      onClick={async () => {
                        const res = await window.api.updateModel(m.id, { watch: !m.watch })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    >
                      {m.watch ? '显示' : '隐藏'}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn sm ghost"
                      onClick={async () => {
                        const res = await window.api.updateModel(m.id, { enabled: !m.enabled })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    >
                      {m.enabled ? <span className="pill ok">启用</span> : <span className="pill">停用</span>}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn sm"
                      onClick={() =>
                        setModel({
                          id: m.id,
                          providerId: m.providerId,
                          upstreamModel: m.upstreamModel,
                          alias: m.alias,
                          priceIn: String(m.priceIn),
                          priceOut: String(m.priceOut),
                          priceCacheRead: String(m.priceCacheRead),
                          priceCacheWrite: String(m.priceCacheWrite),
                          currency: m.currency,
                          dailyBudget: m.dailyBudget ? String(m.dailyBudget) : '',
                          watch: m.watch
                        })
                      }
                    >
                      编辑
                    </button>{' '}
                    <button
                      className="btn sm"
                      onClick={async () => {
                        if (!confirm(`删除模型 ${m.alias}？`)) return
                        const res = await window.api.deleteModel(m.id)
                        if (!res.ok) notify(res.error ?? '删除失败')
                        else {
                          notify('已删除', 'ok')
                          await onChanged()
                        }
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {provider ? (
        <div className="mask" onClick={() => setProvider(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{provider.id ? '编辑供应商' : '添加供应商'}</h3>
            <div className="section" style={{ gap: 10 }}>
              <label className="field">
                <span>名称</span>
                <input
                  type="text"
                  value={provider.name}
                  placeholder="例如 我的中转站"
                  onChange={(e) => setProvider({ ...provider, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Base URL</span>
                <input
                  type="text"
                  className="mono"
                  value={provider.baseUrl}
                  placeholder="https://relay.example.com"
                  onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })}
                />
              </label>
              <label className="field">
                <span>API 格式</span>
                <select
                  value={provider.format}
                  onChange={(e) => setProvider({ ...provider, format: e.target.value as ApiFormat })}
                >
                  <option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
                  <option value="anthropic">Anthropic Messages（/v1/messages）</option>
                </select>
              </label>
              <label className="field">
                <span>API Key {provider.id ? '（留空表示不改）' : ''}</span>
                <input
                  type="password"
                  className="mono"
                  value={provider.apiKey}
                  placeholder="sk-..."
                  onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })}
                />
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setProvider(null)}>
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void saveProvider()}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {model ? (
        <div className="mask" onClick={() => setModel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{model.id ? '编辑模型' : '添加模型'}</h3>
            <div className="section" style={{ gap: 10 }}>
              <label className="field">
                <span>供应商</span>
                <select
                  value={model.providerId}
                  onChange={(e) => setModel({ ...model, providerId: e.target.value })}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}（{FORMAT_LABEL[p.format]}）
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>上游模型名</span>
                <input
                  type="text"
                  className="mono"
                  value={model.upstreamModel}
                  placeholder="claude-sonnet-4-5"
                  onChange={(e) => setModel({ ...model, upstreamModel: e.target.value })}
                />
              </label>
              <label className="field">
                <span>别名（客户端里填这个名字）</span>
                <input
                  type="text"
                  className="mono"
                  value={model.alias}
                  placeholder="my-claude"
                  onChange={(e) => setModel({ ...model, alias: e.target.value })}
                />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>输入单价 / 百万 token</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceIn}
                    onChange={(e) => setModel({ ...model, priceIn: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>输出单价 / 百万 token</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceOut}
                    onChange={(e) => setModel({ ...model, priceOut: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>缓存读单价 / 百万 token</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceCacheRead}
                    onChange={(e) => setModel({ ...model, priceCacheRead: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>缓存写单价 / 百万 token</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceCacheWrite}
                    onChange={(e) => setModel({ ...model, priceCacheWrite: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>货币</span>
                  <select value={model.currency} onChange={(e) => setModel({ ...model, currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>日预算（留空不限）</span>
                  <input
                    type="number"
                    step="0.1"
                    value={model.dailyBudget}
                    onChange={(e) => setModel({ ...model, dailyBudget: e.target.value })}
                  />
                </label>
              </div>
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={model.watch}
                  onChange={(e) => setModel({ ...model, watch: e.target.checked })}
                />
                <span>在悬浮窗显示</span>
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setModel(null)}>
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void saveModel()}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
