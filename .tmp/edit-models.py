import io

p = r'src/renderer/components/Models.tsx'
s = io.open(p, encoding='utf-8').read()
orig = s

s = s.replace("import { fmtMoney } from '../format'", "import { fmtMoney, fmtMs } from '../format'", 1)

s = s.replace(
    "  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)",
    "  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)\n  const [pmenu, setPmenu] = useState<{ id: string; x: number; y: number } | null>(null)",
    1,
)
s = s.replace(
    "  const cols = useColumnWidths('models', [210, 130, 85, 85, 85, 85, 80, 88, 34])",
    "  const cols = useColumnWidths('models', [210, 130, 70, 70, 70, 85, 85, 85, 85, 80, 34])",
    1,
)
s = s.replace(
    "  const providerCols = useColumnWidths('providers', [150, 220, 110, 140, 80, 150])",
    "  const providerCols = useColumnWidths('providers', [150, 220, 110, 140, 80])",
    1,
)

s = s.replace(
    """  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const esc = (e: KeyboardEvent): void => {
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
  }, [menu])""",
    """  useEffect(() => {
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
  }, [menu, pmenu])""",
    1,
)

s = s.replace(
    """                <th className="c-center">状态{providerCols.resizer(4)}</th>
                <th>{providerCols.resizer(5)}</th>""",
    """                <th className="c-center">状态{providerCols.resizer(4)}</th>""",
    1,
)

s = s.replace(
    """              {providers.map((p) => (
                <tr key={p.id}>""",
    """              {providers.map((p) => (
                <tr
                  key={p.id}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setPmenu({ id: p.id, x: e.clientX, y: e.clientY })
                  }}
                >""",
    1,
)

s = s.replace(
    """                  </td>
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
                </tr>""",
    """                  </td>
                </tr>""",
    1,
)

s = s.replace(
    """                <th>供应商{cols.resizer(1)}</th>
                <th title="每百万 token 单价">输入价格{cols.resizer(2)}</th>
                <th title="每百万 token 单价">输出价格{cols.resizer(3)}</th>
                <th title="每百万 token 单价">缓存读取{cols.resizer(4)}</th>
                <th title="每百万 token 单价">缓存输入{cols.resizer(5)}</th>
                <th className="c-center">悬浮窗{cols.resizer(6)}</th>
                <th className="c-center">自动探针{cols.resizer(7)}</th>
                <th className="c-drag">{cols.resizer(8)}</th>""",
    """                <th>供应商{cols.resizer(1)}</th>
                <th className="c-center">TTFT P50{cols.resizer(2)}</th>
                <th className="c-center">TTFT P95{cols.resizer(3)}</th>
                <th className="c-center">TTFT P99{cols.resizer(4)}</th>
                <th title="每百万 token 单价">输入价格{cols.resizer(5)}</th>
                <th title="每百万 token 单价">输出价格{cols.resizer(6)}</th>
                <th title="每百万 token 单价">缓存读取{cols.resizer(7)}</th>
                <th title="每百万 token 单价">缓存输入{cols.resizer(8)}</th>
                <th className="c-center">状态{cols.resizer(9)}</th>
                <th className="c-drag">{cols.resizer(10)}</th>""",
    1,
)

s = s.replace(
    """                    <td>{providers.find((p) => p.id === m.providerId)?.name ?? '—'}</td>
                    <td className="mono">{fmtMoney(m.priceIn, m.currency)}</td>""",
    """                    <td>{providers.find((p) => p.id === m.providerId)?.name ?? '—'}</td>
                    <td className="mono c-center">{fmtMs(live?.ttftP50 ?? null)}</td>
                    <td className="mono c-center">{fmtMs(live?.ttftP95 ?? null)}</td>
                    <td className="mono c-center">{fmtMs(live?.ttftP99 ?? null)}</td>
                    <td className="mono">{fmtMoney(m.priceIn, m.currency)}</td>""",
    1,
)

old_cells = """                    <td className="mono">{m.cacheInputSupported === false ? '—' : fmtMoney(m.priceCacheInput, m.currency)}</td>
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
                    <td className="c-drag">"""
new_cells = """                    <td className="mono">{m.cacheInputSupported === false ? '—' : fmtMoney(m.priceCacheInput, m.currency)}</td>
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
                    <td className="c-drag">"""
s = s.replace(old_cells, new_cells, 1)

old_menu = """                <button
                  onClick={async () => {
                    setMenu(null)
                    const res = await window.api.updateModel(m.id, { enabled: !m.enabled })
                    if (!res.ok) notify(res.error ?? '切换失败')
                    else await onChanged()
                  }}
                >
                  {m.enabled ? '关闭' : '开启'}
                </button>"""
new_menu = """                <button
                  onClick={async () => {
                    setMenu(null)
                    const picked = config.settings.overlay.modelId === m.id
                    const res = await window.api.updateSettings({ overlayModelId: picked ? null : m.id })
                    if (!res.ok) notify(res.error ?? '切换失败')
                    else await onChanged()
                  }}
                >
                  {config.settings.overlay.modelId === m.id ? '取消悬浮窗显示' : '显示在悬浮窗'}
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
                </button>"""
s = s.replace(old_menu, new_menu, 1)

# 供应商右键菜单渲染：插在模型菜单之前
anchor = """      {menu
        ? (() => {"""
provider_menu = """      {pmenu
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
              </div>
            )
          })()
        : null}

"""
s = s.replace(anchor, provider_menu + anchor, 1)

assert s != orig
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('models done')
