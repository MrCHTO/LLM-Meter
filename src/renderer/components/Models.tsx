import { useEffect, useState } from 'react'
import { useApp, useConfig } from '../state/AppState'
import type { ModelCfg, ProviderView } from '../../shared/types'

import { FORMAT_LABEL } from '../../shared/types'
import { fmtMoney, fmtMs } from '../../shared/format'
import { Confirm, useConfirm } from './Confirm'
import { useColumnWidths } from '../columns'
import { EMPTY_PROVIDER, emptyModel, type ModelDraft, type ProviderDraft } from './models/drafts'
import { ModelForm } from './models/ModelForm'
import { ProviderForm } from './models/ProviderForm'

export function Models(): JSX.Element {
  const config = useConfig()
  const { snapshot, notify, reload: onChanged } = useApp()
  const [provider, setProvider] = useState<ProviderDraft | null>(null)
  const [model, setModel] = useState<ModelDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [priceNote, setPriceNote] = useState('')
  const [lookedUpFor, setLookedUpFor] = useState('')
  /** 查价时顺便探测上游是否上报缓存输入字段 */
  const [writeField, setWriteField] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pmenu, setPmenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const cols = useColumnWidths('models', [210, 130, 70, 70, 70, 85, 85, 85, 85, 80])
  const providerCols = useColumnWidths('providers', [150, 220, 110, 140, 80])
  const { ask, confirmProps } = useConfirm()

  useEffect(() => {
    if (!menu && !pmenu) return
    const close = (): void => {
      setMenu(null)
      setPmenu(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [menu, pmenu])

  const openEdit = (m: ModelCfg): void => {
    setPriceNote('')
    setLookedUpFor('')
    setWriteField('unknown')
    setModel({
      id: m.id,
      providerId: m.providerId,
      upstreamModel: m.upstreamModel,
      alias: m.alias,
      priceIn: (Math.round(m.priceIn * 10) / 10).toFixed(1),
      priceOut: (Math.round(m.priceOut * 10) / 10).toFixed(1),
      priceCacheRead: (Math.round(m.priceCacheRead * 10) / 10).toFixed(1),
      priceCacheInput: (Math.round(m.priceCacheInput * 10) / 10).toFixed(1),
      cacheInputSupported: m.cacheInputSupported ?? null,
      currency: m.currency,
      watch: m.watch
    })
  }

  const remove = async (m: ModelCfg): Promise<void> => {
    if (!(await ask(`删除模型 ${m.alias}？`))) return
    const res = await window.api.deleteModel(m.id)
    if (!res.ok) notify(res.error ?? '删除失败')
    else {
      notify('已删除', 'ok')
      await onChanged()
    }
  }

  const dropOn = async (targetId: string, sourceId: string | null): Promise<void> => {
    if (!sourceId || sourceId === targetId) return
    const all = config.models.map((m) => m.id)
    const from = all.indexOf(sourceId)
    const to = all.indexOf(targetId)
    if (from < 0 || to < 0) return
    const ids = all.filter((id) => id !== sourceId)
    // 往下拖放到目标行之后，往上拖放到目标行之前
    ids.splice(ids.indexOf(targetId) + (from < to ? 1 : 0), 0, sourceId)
    setDragId(null)
    const res = await window.api.reorderModels(ids)
    if (!res.ok) notify(res.error ?? '排序失败')
    else await onChanged()
  }

  /** 按模型 id 去 OpenRouter 拿公开价，查不到就留着手填 */
  const lookupPrice = async (modelId: string): Promise<void> => {
    if (!modelId.trim()) return
    setLookedUpFor(modelId.trim())
    setPriceNote('查询中…')
    const res = await window.api.lookupPrice(modelId, model?.providerId)
    if (!res.ok || !res.data) {
      setPriceNote('连接openrouter超时，请手动填写')
      return
    }
    const data = res.data
    if (data.cacheWriteProbed) {
      setWriteField(data.cacheWriteReported ? 'yes' : 'no')
      setPriceNote(data.cacheWriteReported ? data.note : `${data.note}；该通道无缓存输入字段，缓存输入价已禁用`)
    } else {
      setWriteField('unknown')
      setPriceNote(data.note)
    }
    if (!data.found) return
    setModel((m) =>
      m
        ? {
            ...m,
            priceIn: String(Math.round((data.priceIn ?? 0) * 100) / 100),
            priceOut: String(Math.round((data.priceOut ?? 0) * 100) / 100),
            priceCacheRead: String(Math.round((data.priceCacheRead ?? 0) * 100) / 100),
            priceCacheInput:
              data.cacheWriteProbed && !data.cacheWriteReported
                ? ''
                : String(Math.round((data.priceCacheInput ?? 0) * 100) / 100),
            cacheInputSupported: data.cacheWriteProbed ? data.cacheWriteReported === true : m.cacheInputSupported,
            currency: 'CNY'
          }
        : m
    )
  }

  const saveProvider = async (): Promise<void> => {
    if (!provider) return
    if (!provider.name.trim()) {
      notify('供应商名称不能为空')
      return
    }
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
      r1(current.priceCacheInput) !== r1(Number(draft.priceCacheInput) || 0)
    return changed ? 'manual' : current.priceSource
  }

  const saveModel = async (): Promise<void> => {
    if (!model) return
    if (!model.providerId) {
      notify('请选择供应商')
      return
    }
    if (!model.alias.trim()) {
      notify('别名不能为空')
      return
    }
    const current = model.id ? config.models.find((x) => x.id === model.id) : undefined
    const payload: Omit<ModelCfg, 'id' | 'createdAt' | 'sort'> = {
      providerId: model.providerId,
      upstreamModel: model.upstreamModel,
      alias: model.alias,
      enabled: current?.enabled ?? true,
      watch: model.watch,
      showRate: current?.showRate ?? true,
      priceIn: Number(model.priceIn) || 0,
      priceOut: Number(model.priceOut) || 0,
      priceCacheRead: Number(model.priceCacheRead) || 0,
      priceCacheInput: Number(model.priceCacheInput) || 0,
      cacheInputSupported: model.cacheInputSupported,
      currency: model.currency,
      priceSource: priceSourceFor(model),
      autoProbe: current?.autoProbe ?? false
    }
    setBusy(true)
    const res = model.id ? await window.api.updateModel(model.id, payload) : await window.api.createModel(payload)
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
          <table className={`tbl-left${providerCols.fixed ? ' col-fixed' : ''}`} {...providerCols.tableProps}>
            {providerCols.colgroup}
            <thead>
              <tr>
                <th>名称{providerCols.resizer(0)}</th>
                <th>Base URL{providerCols.resizer(1)}</th>
                <th className="c-left">协议{providerCols.resizer(2)}</th>
                <th className="c-left">Key{providerCols.resizer(3)}</th>
                <th className="c-center">状态{providerCols.resizer(4)}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr
                  key={p.id}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setPmenu({ id: p.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  <td>{p.name}</td>
                  <td className="mono" style={{ textAlign: 'left' }}>
                    {p.baseUrl}
                  </td>
                  <td className="c-left">{FORMAT_LABEL[p.format]}</td>
                  <td className="mono c-left">{p.keyMasked}</td>
                  <td className="c-center">
                    <button
                      role="switch"
                      aria-checked={p.enabled}
                      title={p.enabled ? '已启用' : '已停用'}
                      className={p.enabled ? 'switch on' : 'switch'}
                      onClick={async () => {
                        const res = await window.api.updateProvider(p.id, { enabled: !p.enabled })
                        if (!res.ok) notify(res.error ?? '切换失败')
                        else await onChanged()
                      }}
                    />
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
              setWriteField('unknown')
              setModel(emptyModel(providers[0]?.id ?? ''))
            }}
          >
            添加模型
          </button>
        </div>
        {config.models.length === 0 ? (
          <div className="empty">{providers.length === 0 ? '先添加供应商' : '还没有模型'}</div>
        ) : (
          <table className={`tbl-left tbl-models${cols.fixed ? ' col-fixed' : ''}`} {...cols.tableProps}>
            {cols.colgroup}
            <thead>
              <tr>
                <th>别名/模型{cols.resizer(0)}</th>
                <th>供应商{cols.resizer(1)}</th>
                <th className="c-center">TTFT P50{cols.resizer(2)}</th>
                <th className="c-center">TTFT P95{cols.resizer(3)}</th>
                <th className="c-center">TTFT P99{cols.resizer(4)}</th>
                <th title="每百万 token 单价">输入价格{cols.resizer(5)}</th>
                <th title="每百万 token 单价">输出价格{cols.resizer(6)}</th>
                <th title="每百万 token 单价">缓存读取{cols.resizer(7)}</th>
                <th title="每百万 token 单价">缓存输入{cols.resizer(8)}</th>
                <th className="c-center th-drag-pad">状态{cols.resizer(9)}</th>
              </tr>
            </thead>
            <tbody>
              {config.models.map((m) => {
                const live = snapshot?.models.find((x) => x.modelId === m.id)
                return (
                  <tr
                    key={m.id}
                    className={[
                      'row-drag',
                      m.enabled ? '' : 'row-off',
                      m.autoProbe && (live?.probeFails ?? 0) >= 3 && 'bad-flash',
                      dragId === m.id && 'dragging'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const sourceId = e.dataTransfer?.getData('text/plain') || dragId
                      void dropOn(m.id, sourceId)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ id: m.id, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <td>
                      <div className="row-name">
                        <div className="cell-model">
                          <b>{m.alias}</b>
                          <small className="mono">{m.upstreamModel}</small>
                        </div>
                      </div>
                    </td>
                    <td>{providers.find((p) => p.id === m.providerId)?.name ?? '—'}</td>
                    <td className="mono c-center">{fmtMs(live?.ttftP50 ?? null)}</td>
                    <td className="mono c-center">{fmtMs(live?.ttftP95 ?? null)}</td>
                    <td className="mono c-center">{fmtMs(live?.ttftP99 ?? null)}</td>
                    <td className="mono">{fmtMoney(m.priceIn, m.currency)}</td>
                    <td className="mono">{fmtMoney(m.priceOut, m.currency)}</td>
                    <td className="mono">{fmtMoney(m.priceCacheRead, m.currency)}</td>
                    <td className="mono">
                      {m.cacheInputSupported === false ? '—' : fmtMoney(m.priceCacheInput, m.currency)}
                    </td>
                    <td className="c-center">
                      <button
                        role="switch"
                        aria-checked={m.enabled}
                        title={m.enabled ? '已启用' : '已停用'}
                        className={m.enabled ? 'switch on' : 'switch'}
                        onClick={async () => {
                          const res = await window.api.updateModel(m.id, { enabled: !m.enabled })
                          if (!res.ok) notify(res.error ?? '切换失败')
                          else await onChanged()
                        }}
                      />
                      <span
                        className="grip row-grip"
                        draggable
                        title="拖动排序"
                        onDragStart={(e) => {
                          e.dataTransfer?.setData('text/plain', m.id)
                          setDragId(m.id)
                        }}
                        onDragEnd={() => setDragId(null)}
                      >
                        ⋮⋮
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {pmenu
        ? (() => {
            const p = providers.find((x) => x.id === pmenu.id)
            if (!p) return null
            return (
              <div
                className="ctxmenu"
                style={{
                  left: Math.min(pmenu.x, window.innerWidth - 130),
                  top: Math.min(pmenu.y, window.innerHeight - 120)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setPmenu(null)
                    void test(p)
                  }}
                >
                  测试
                </button>
                <button
                  onClick={() => {
                    setPmenu(null)
                    setProvider({ id: p.id, name: p.name, baseUrl: p.baseUrl, format: p.format, apiKey: '' })
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={async () => {
                    setPmenu(null)
                    if (!(await ask(`删除供应商 ${p.name} 及其下所有模型？`))) return
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
              </div>
            )
          })()
        : null}

      {menu
        ? (() => {
            const m = config.models.find((x) => x.id === menu.id)
            if (!m) return null
            return (
              <div
                className="ctxmenu"
                style={{
                  left: Math.min(menu.x, window.innerWidth - 130),
                  top: Math.min(menu.y, window.innerHeight - 120)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={async () => {
                    setMenu(null)
                    const picked = config.settings.overlay.global !== true && config.settings.overlay.modelId === m.id
                    const res = await window.api.updateSettings(
                      picked ? { overlayModelId: null } : { overlayModelId: m.id, overlayGlobal: false }
                    )
                    if (!res.ok) notify(res.error ?? '切换失败')
                    else await onChanged()
                  }}
                >
                  {config.settings.overlay.global !== true && config.settings.overlay.modelId === m.id
                    ? '取消悬浮窗显示'
                    : '显示在悬浮窗'}
                </button>
                <button
                  onClick={async () => {
                    setMenu(null)
                    const res = await window.api.updateModel(m.id, { autoProbe: !m.autoProbe })
                    if (!res.ok) notify(res.error ?? '切换失败')
                    else await onChanged()
                  }}
                >
                  {m.autoProbe ? '关闭自动探针' : '开启自动探针'}
                </button>
                <button
                  onClick={() => {
                    setMenu(null)
                    openEdit(m)
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={() => {
                    setMenu(null)
                    void remove(m)
                  }}
                >
                  删除
                </button>
              </div>
            )
          })()
        : null}

      {provider ? (
        <ProviderForm
          draft={provider}
          busy={busy}
          onChange={setProvider}
          onSave={() => void saveProvider()}
          onClose={() => setProvider(null)}
        />
      ) : null}

      {model ? (
        <ModelForm
          draft={model}
          providers={providers}
          busy={busy}
          priceNote={priceNote}
          lookedUpFor={lookedUpFor}
          writeField={writeField}
          onChange={setModel}
          onLookup={(name) => void lookupPrice(name)}
          onPriceNote={setPriceNote}
          onSave={() => void saveModel()}
          onClose={() => setModel(null)}
        />
      ) : null}
      <Confirm {...confirmProps} />
    </div>
  )
}
