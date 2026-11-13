import { useState } from 'react'
import type { ApiFormat, ConfigView, LiveSnapshot, ModelCfg, ProviderView } from '../../shared/types'
import { FORMAT_LABEL } from '../../shared/types'
import { fmtMoney } from '../format'

interface Props {
  config: ConfigView
  snapshot: LiveSnapshot | null
  notify: (text: string, kind?: 'ok' | 'bad') => void
  onChanged: () => Promise<void>
}

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
    currency: 'CNY',
    watch: true
  }
}

export function Models({ config, snapshot, notify, onChanged }: Props): JSX.Element {
  const [provider, setProvider] = useState<ProviderDraft | null>(null)
  const [model, setModel] = useState<ModelDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [priceNote, setPriceNote] = useState('')
  const [lookedUpFor, setLookedUpFor] = useState('')

  /** 按模型 id 去 OpenRouter 拿公开价，查不到就留着手填 */
  const lookupPrice = async (modelId: string): Promise<void> => {
    if (!modelId.trim()) return
    setLookedUpFor(modelId.trim())
    setPriceNote('查询中…')
    const res = await window.api.lookupPrice(modelId)
    if (!res.ok || !res.data) {
      setPriceNote('连接openrouter超时，请手动填写')
      return
    }
    const data = res.data
    setPriceNote(data.note)
    if (!data.found) return
    setModel((m) =>
      m
        ? {
            ...m,
            priceIn: String(Math.round((data.priceIn ?? 0) * 100) / 100),
            priceOut: String(Math.round((data.priceOut ?? 0) * 100) / 100),
            priceCacheRead: String(Math.round((data.priceCacheRead ?? 0) * 100) / 100),
            priceCacheWrite: String(Math.round((data.priceCacheWrite ?? 0) * 100) / 100),
            currency: 'CNY'
          }
        : m
    )
  }

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

  // 改过价格就落手动；没动过保留原来源（表单按一位小数回显，比较时同样取整）
  const priceSourceFor = (draft: ModelDraft): 'auto' | 'manual' => {
    if (!draft.id) return 'manual'
    const current = config.models.find((x) => x.id === draft.id)
    if (!current) return 'manual'
    const r1 = (n: number): number => Math.round(n * 10) / 10
    const changed =
      r1(current.priceIn) !== r1(Number(draft.priceIn) || 0) ||
      r1(current.priceOut) !== r1(Number(draft.priceOut) || 0) ||
      r1(current.priceCacheRead) !== r1(Number(draft.priceCacheRead) || 0) ||
      r1(current.priceCacheWrite) !== r1(Number(draft.priceCacheWrite) || 0)
    return changed ? 'manual' : current.priceSource
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
      priceSource: priceSourceFor(model),
      autoProbe: model.id ? (config.models.find((x) => x.id === model.id)?.autoProbe ?? false) : false
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
          </div>
          <button className="btn primary" onClick={() => setProvider({ ...EMPTY_PROVIDER })}>
            添加供应商
          </button>
        </div>
        {providers.length === 0 ? (
          <div className="empty">还没有供应商</div>
        ) : (
          <table className="tbl-left">
            <thead>
              <tr>
                <th>名称</th>
                <th>Base URL</th>
                <th className="c-left">协议</th>
                <th className="c-left">Key</th>
                <th className="c-center">状态</th>
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
                  <td className="c-left">{FORMAT_LABEL[p.format]}</td>
                  <td className="mono c-left">{p.keyMasked}</td>
                  <td className="c-center">
                    <button
                      className={p.enabled ? 'state on' : 'state'}
                      onClick={async () => {
                        const res = await window.api.updateProvider(p.id, { enabled: !p.enabled })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    >
                      {p.enabled ? '启用' : '停用'}
                    </button>
                  </td>
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
          </div>
          <button
            className="btn primary"
            disabled={providers.length === 0}
            onClick={() => {
              setPriceNote('')
              setLookedUpFor('')
              setModel(emptyModel(providers[0]?.id ?? ''))
            }}
          >
            添加模型
          </button>
        </div>
        {config.models.length === 0 ? (
          <div className="empty">{providers.length === 0 ? '先添加供应商' : '还没有模型'}</div>
        ) : (
          <table className="tbl-left tbl-models">
            <thead>
              <tr>
                <th>别名</th>
                <th>上游模型</th>
                <th title="每百万 token 单价">输入</th>
                <th title="每百万 token 单价">输出</th>
                <th title="每百万 token 单价">缓存读取</th>
                <th title="每百万 token 单价">缓存写入</th>
                <th className="c-center">悬浮窗</th>
                <th className="c-center">状态</th>
                <th className="c-center">自动探针</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {config.models.map((m) => {
                const live = snapshot?.models.find((x) => x.modelId === m.id)
                const probeTime = live?.lastProbeAt ?? null
                const probeTitle = probeTime
                  ? `上次探针：${new Date(probeTime).toLocaleTimeString()}`
                  : m.autoProbe
                    ? '尚未探测'
                    : '自动探针未开启'
                return (
                  <tr key={m.id} className={m.autoProbe && (live?.probeFails ?? 0) >= 3 ? 'bad-flash' : undefined}>
                    <td>
                      <span
                        className={
                          'probe-dot' +
                          (probeTime === null ? '' : live?.lastProbeOk ? ' on' : ' off') +
                          (m.autoProbe ? '' : ' idle')
                        }
                        title={probeTitle}
                      />
                      {m.alias}
                    </td>
                  <td className="mono" style={{ textAlign: 'left' }}>
                    {m.upstreamModel}
                  </td>
                  <td className="mono">{fmtMoney(m.priceIn, m.currency)}</td>
                  <td className="mono">{fmtMoney(m.priceOut, m.currency)}</td>
                  <td className="mono">{fmtMoney(m.priceCacheRead, m.currency)}</td>
                  <td className="mono">{fmtMoney(m.priceCacheWrite, m.currency)}</td>
                  <td className="c-center">
                    <button
                      className={config.settings.overlay.modelId === m.id ? 'pick on' : 'pick'}
                      onClick={async () => {
                        const picked = config.settings.overlay.modelId === m.id
                        const res = await window.api.updateSettings({ overlayModelId: picked ? null : m.id })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    >
                      {config.settings.overlay.modelId === m.id ? '● 已选' : '○ 选中'}
                    </button>
                  </td>
                  <td className="c-center">
                    <button
                      className={m.enabled ? 'state on' : 'state'}
                      onClick={async () => {
                        const res = await window.api.updateModel(m.id, { enabled: !m.enabled })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    >
                      {m.enabled ? '启用' : '停用'}
                    </button>
                  </td>
                  <td className="c-center">
                    <button
                      className={m.autoProbe ? 'state on' : 'state'}
                      onClick={async () => {
                        const res = await window.api.updateModel(m.id, { autoProbe: !m.autoProbe })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    >
                      {m.autoProbe ? '关闭' : '开启'}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn sm"
                      onClick={() => {
                        setPriceNote('')
              setLookedUpFor('')
                        setModel({
                          id: m.id,
                          providerId: m.providerId,
                          upstreamModel: m.upstreamModel,
                          alias: m.alias,
                          priceIn: (Math.round(m.priceIn * 10) / 10).toFixed(1),
                          priceOut: (Math.round(m.priceOut * 10) / 10).toFixed(1),
                          priceCacheRead: (Math.round(m.priceCacheRead * 10) / 10).toFixed(1),
                          priceCacheWrite: (Math.round(m.priceCacheWrite * 10) / 10).toFixed(1),
                          currency: m.currency,
                          watch: m.watch
                        })
                      }}
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
                )
              })}
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
                <span>协议</span>
                <select
                  value={provider.format}
                  onChange={(e) => setProvider({ ...provider, format: e.target.value as ApiFormat })}
                >
                  <option value="openai">OpenAI（/v1/chat/completions）</option>
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
                <div className="row">
                  <input
                    type="text"
                    className="mono"
                    value={model.upstreamModel}
                    placeholder="deepseek/deepseek-v4.1-flash"
                    onChange={(e) => {
                      const value = e.target.value
                      setModel({ ...model, upstreamModel: value })
                      if (priceNote && value.trim() !== lookedUpFor) {
                        setPriceNote('模型名已改，点「查价」按新名字重查')
                      }
                    }}
                    onBlur={() => {
                      const empty = !model.priceIn || Number(model.priceIn) === 0
                      if (empty && model.upstreamModel.trim()) void lookupPrice(model.upstreamModel)
                    }}
                  />
                  <button className="btn" onClick={() => void lookupPrice(model.upstreamModel)}>
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
                  value={model.alias}
                  placeholder="my-claude"
                  onChange={(e) => setModel({ ...model, alias: e.target.value })}
                />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>输入单价 / 百万 token / ¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceIn}
                    onChange={(e) => setModel({ ...model, priceIn: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>输出单价 / 百万 token / ¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceOut}
                    onChange={(e) => setModel({ ...model, priceOut: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>缓存读取单价 / 百万 token / ¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceCacheRead}
                    onChange={(e) => setModel({ ...model, priceCacheRead: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>缓存写入单价 / 百万 token / ¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={model.priceCacheWrite}
                    onChange={(e) => setModel({ ...model, priceCacheWrite: e.target.value })}
                  />
                </label>
              </div>
              <div className="row mt" style={{ gap: 8 }}>
                {(() => {
                  const source = model.id ? config.models.find((x) => x.id === model.id)?.priceSource : undefined
                  return model.id ? (
                    <>
                      <span className="muted">价格来源：{source === 'manual' ? '手动' : '自动校准'}</span>
                      <button
                        className="btn sm"
                        disabled={source !== 'manual'}
                        onClick={async () => {
                          if (!model.id) return
                          const res = await window.api.updateModel(model.id, { priceSource: 'auto' })
                          if (!res.ok) notify(res.error ?? '恢复失败')
                          else await onChanged()
                        }}
                      >
                        恢复自动
                      </button>
                    </>
                  ) : (
                    <span className="muted">新建模型的价格按手动记，之后可「恢复自动」交给每天校准</span>
                  )
                })()}
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
