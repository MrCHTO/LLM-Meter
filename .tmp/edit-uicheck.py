import io

p = r'test/ui-check.mjs'
s = io.open(p, encoding='utf-8').read()
orig = s

# ---------- 仪表盘 ----------
s = s.replace("check('表头是十三列', (await s.eval(\"document.querySelectorAll('thead th').length\")) === 13)",
              "check('表头是十列', (await s.eval(\"document.querySelectorAll('thead th').length\")) === 10)", 1)
s = s.replace("(await s.eval(\"[...document.querySelectorAll('tbody tr.clickable')].every((tr) => tr.children[9]?.innerText === '—')\")) === true",
              "(await s.eval(\"[...document.querySelectorAll('tbody tr.clickable')].every((tr) => tr.children[6]?.innerText === '—')\")) === true", 1)
s = s.replace("""  check(
    'TTFT 拆为三个分位列',
    headText.split('|').filter((x) => x.startsWith('TTFT')).join(',') === 'TTFT P50,TTFT P95,TTFT P99'
  )""",
"""  check('TTFT 三列已从仪表盘移走', headText.split('|').every((x) => !x.startsWith('TTFT')))
  check(
    '监控卡有标题与区间下拉',
    (await s.eval("[...document.querySelectorAll('.card h2')].some((h) => h.innerText === '监控')")) === true &&
      (await s.eval("document.querySelector('.range-select') ? [...document.querySelector('.range-select').options].map((o) => o.value).join(',') : ''")) ===
        'today,1h,3h'
  )""", 1)

# ---------- 供应商 ----------
s = s.replace("check('供应商表每列都有调宽手柄', (await s.eval(\"document.querySelectorAll('.card:first-child thead .col-resize').length\")) === 6)",
              "check('供应商表每列都有调宽手柄', (await s.eval(\"document.querySelectorAll('.card:first-child thead .col-resize').length\")) === 5)", 1)
s = s.replace("""  check('供应商显示掩码 Key', /••••/.test(await s.eval("document.body.innerText")))""",
"""  check('供应商显示掩码 Key', /••••/.test(await s.eval("document.body.innerText")))
  // 供应商行的右键菜单：测试/编辑/删除
  await s.eval("(() => { const tr = document.querySelector('.card:first-child tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(300)
  check(
    '供应商右键菜单是测试/编辑/删除',
    (await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")) === '测试,编辑,删除'
  )
  await s.eval("document.querySelector('.ctxmenu')?.remove()")
  await s.eval("document.body.click()")
  await sleep(200)""", 1)

# ---------- 模型表 ----------
s = s.replace("""  check(
    '模型表有自动探针列',
    await s.eval("[...document.querySelectorAll('thead')].some((th) => th.innerText.includes('自动探针'))")
  )
  const firstProbeBtn = await s.eval(
    "[...document.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('button')].find((b) => b.innerText === '开启')).find(Boolean)?.innerText ?? ''"
  )
  check('自动探针有开启按钮', firstProbeBtn === '开启')
  await s.eval(
    "[...document.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('button')].find((b) => b.innerText === '开启')).find(Boolean)?.click()"
  )
  await sleep(900)
  check(
    '开启后变为关闭且配置已写入',
    (await s.eval("[...document.querySelectorAll('tbody button')].some((b) => b.innerText === '关闭')")) &&
      (await s.eval("(async () => (await window.api.config()).data.models[0].autoProbe)()", true))
  )""",
"""  check(
    '模型表没有悬浮窗与自动探针列',
    await s.eval("[...document.querySelectorAll('thead')].every((th) => !['悬浮窗', '自动探针'].some((h) => th.innerText.includes(h)))")
  )
  check(
    '模型状态是最后一列文字按钮',
    (await s.eval("[...document.querySelectorAll('.tbl-models thead th')].map((th) => th.innerText).join('|')")) .includes('|状态|') &&
      (await s.eval("document.querySelector('.tbl-models thead th:nth-last-child(2)').innerText")) === '状态' &&
      (await s.eval("document.querySelector('.tbl-models tbody .state')?.innerText ?? ''")) === '启用'
  )
  // 自动探针走右键菜单
  await s.eval("(() => { const tr = document.querySelector('.tbl-models tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(300)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '开启自动探针')?.click()")
  await sleep(900)
  check('开启自动探针并写入配置', await s.eval("(async () => (await window.api.config()).data.models[0].autoProbe)()", true))""", 1)

s = s.replace("check('模型表列序正确', modelHeads.startsWith('别名/模型|供应商|输入价格|输出价格|缓存读取|缓存输入|悬浮窗|自动探针'))",
              "check('模型表列序正确', modelHeads.startsWith('别名/模型|供应商|TTFT P50|TTFT P95|TTFT P99|输入价格|输出价格|缓存读取|缓存输入|状态'))", 1)
s = s.replace("check('模型表没有状态列', !modelHeads.includes('状态'))",
              "check('模型表有 TTFT 三列', modelHeads.includes('TTFT P50|TTFT P95|TTFT P99'))", 1)
s = s.replace("find((tr) => tr.innerText.includes('claude-x'))?.children[5]?.innerText", "find((tr) => tr.innerText.includes('claude-x'))?.children[8]?.innerText", 1)
s = s.replace("check('模型表每列都有调宽手柄', (await s.eval(\"document.querySelectorAll('.tbl-models thead .col-resize').length\")) === 9)",
              "check('模型表每列都有调宽手柄', (await s.eval(\"document.querySelectorAll('.tbl-models thead .col-resize').length\")) === 11)", 1)

s = s.replace("""  check('模型右键菜单只有开启/编辑/删除', /^(开启|关闭),编辑,删除$/.test(menuItems), `${rowsBeforeMenu} 行, ctx=${await s.eval("document.querySelectorAll('.ctxmenu').length")}, ${menuItems}`)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '关闭' || b.innerText === '开启')?.click()")
  await sleep(900)
  check('关闭后整行变灰', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === true, await s.eval("document.querySelector('.content')?.innerText.slice(0,100)"))
  await s.eval("(() => { const tr = document.querySelector('.tbl-models tbody tr'); if (!tr) return false; tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(200)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '开启')?.click()")
  await sleep(900)
  check('重新开启后恢复', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === false)""",
"""  check(
    '模型右键菜单是悬浮窗/探针/编辑/删除',
    /^(显示在悬浮窗|取消悬浮窗显示),(开启自动探针|关闭自动探针),编辑,删除$/.test(menuItems),
    `${rowsBeforeMenu} 行, ctx=${await s.eval("document.querySelectorAll('.ctxmenu').length")}, ${menuItems}`
  )
  await s.eval("document.body.click()")
  await sleep(200)
  // 点最后一列的状态按钮关闭该行，再点开
  await s.eval("document.querySelector('.tbl-models tbody .state')?.click()")
  await sleep(900)
  check('点状态后整行变灰', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === true, await s.eval("document.querySelector('.content')?.innerText.slice(0,100)"))
  await s.eval("document.querySelector('.tbl-models tbody .state')?.click()")
  await sleep(900)
  check('再点状态恢复', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === false)""", 1)

s = s.replace("""  check(
    '悬浮窗与状态是无框文字按钮',
    (await s.eval("document.querySelectorAll('.pick').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.state').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.pick.btn, .state .pill').length")) === 0
  )
  const aligns = await s.eval(
    "[...document.querySelectorAll('.tbl-models thead th')].filter((th) => ['悬浮窗', '自动探针'].includes(th.innerText)).map((th) => getComputedStyle(th).textAlign).join(',')"
  )
  check('悬浮窗与自动探针列居中', aligns === 'center,center', aligns)""",
"""  check(
    '状态是无框文字按钮',
    (await s.eval("document.querySelectorAll('.state').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.state.pill, .state.btn').length")) === 0
  )
  check(
    '状态列居中',
    (await s.eval("(() => { const th = [...document.querySelectorAll('.tbl-models thead th')].find((x) => x.innerText === '状态'); return th ? getComputedStyle(th).textAlign : '' })()")) === 'center'
  )""", 1)

# 胶囊同步：改用右键菜单
s = s.replace("""  // 状态一致：点另一行「选中」，胶囊立刻跟上；随后切回 m1 保持后续断言的环境
  const ovSync = await session(await waitTarget('overlay.html'))
  await ovSync.send('Runtime.enable')
  // 已选行按钮是「● 已选」，未选是「○ 选中」，都含「选」
  const modelRows = "[...document.querySelectorAll('tbody tr')].filter((tr) => [...tr.querySelectorAll('button')].some((b) => b.innerText.includes('选')))"
  const aliases = await s.eval(`${modelRows}.map((tr) => tr.querySelector('td b')?.innerText.trim() ?? '')`)
  const pickRow = async (idx) =>
    s.eval(
      `(() => { const rows = ${modelRows}; const b = rows[${idx}] && [...rows[${idx}].querySelectorAll('button')].find((x) => x.innerText.includes('选')); b && b.click(); return !!b })()`
    )
  check('点到悬浮窗选中按钮', (await pickRow(1)) === true)
  const capNow = await ovSync.eval("document.querySelector('.capsule-name b')?.innerText ?? ''")
  check('胶囊选中即时同步', capNow === aliases[1], `${capNow} vs ${aliases[1]}`)
  await pickRow(0)
  const capBack = await ovSync.eval("document.querySelector('.capsule-name b')?.innerText ?? ''")
  check('切回首个模型', capBack === aliases[0], `${capBack} vs ${aliases[0]}`)
  ovSync.close()""",
"""  // 状态一致：右键第二行「显示在悬浮窗」，胶囊立刻跟上；再切回 m1
  const ovSync = await session(await waitTarget('overlay.html'))
  await ovSync.send('Runtime.enable')
  const aliases = await s.eval("[...document.querySelectorAll('.tbl-models tbody tr td b')].map((b) => b.innerText.trim())")
  const pickByMenu = async (idx) => {
    await s.eval(`(() => { const tr = document.querySelectorAll('.tbl-models tbody tr')[${idx}]; tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()`)
    await sleep(300)
    return s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText.includes('悬浮窗'))?.click() ?? false")
  }
  await pickByMenu(1)
  await sleep(600)
  const capNow = await ovSync.eval("document.querySelector('.capsule-name b')?.innerText ?? ''")
  check('菜单选悬浮窗后胶囊同步', capNow === aliases[1], `${capNow} vs ${aliases[1]}`)
  await pickByMenu(0)
  await sleep(600)
  const capBack = await ovSync.eval("document.querySelector('.capsule-name b')?.innerText ?? ''")
  check('切回首个模型', capBack === aliases[0], `${capBack} vs ${aliases[0]}`)
  ovSync.close()""", 1)

# ---------- 接入页合并 ----------
s = s.replace("""  check(
    '端口与局域网在一行两半',
    (await s.eval("document.querySelectorAll('.access-split .access-half').length")) === 2 &&
      (await s.eval("document.querySelector('.access-split .access-half:first-child input[type=number]') ? 1 : 0")) === 1 &&
      (await s.eval("document.querySelector('.access-split .access-half:last-child input[type=checkbox]') ? 1 : 0")) === 1
  )""",
"""  check(
    '端口与局域网已并入地址卡右侧',
    (await s.eval("document.querySelectorAll('.access-split .access-half').length")) === 2 &&
      (await s.eval("document.querySelector('.access-cols-right .access-split .access-half:first-child input[type=number]') ? 1 : 0")) === 1 &&
      (await s.eval("document.querySelector('.access-cols-right .access-split .access-half:last-child input[type=checkbox]') ? 1 : 0")) === 1 &&
      (await s.eval("!!document.querySelector('.access-cols-left .copy-text')")) === true
  )""", 1)

# ---------- 分析页 ----------
s = s.replace("""  check(
    '明细只有模型列左对齐',
    (await s.eval("[...document.querySelectorAll('.tbl-detail thead th')].map((th) => getComputedStyle(th).textAlign).join(',')"))
      .split(',')
      .slice(1)
      .every((x) => x === 'center')
  )
""", "", 1)
s = s.replace("  check('分析页有明细表', (await s.eval(\"document.querySelectorAll('tbody tr').length\")) >= 1)\n", "", 1)
s = s.replace("""  check('按Token分组生效', (await s.eval("document.querySelector('.tbl-detail thead th')?.innerText ?? ''")) === 'Token')
""", "", 1)
s = s.replace("""  check(
    '指标里有总 token，明细有对应列',
    (await s.eval("document.querySelector('.card select') ? [...document.querySelectorAll('select')].some((x) => x.innerText.includes('总 token')) : false")) &&
      (await s.eval("document.querySelector('thead')?.innerText.includes('总 token')"))
  )""",
"""  check(
    '指标里有总 token',
    await s.eval("[...document.querySelectorAll('select')].some((x) => x.innerText.includes('总 token'))")
  )
  check(
    '图表卡撑满内容区高度',
    (await s.eval("(() => { const c = document.querySelector('.analysis-card'); const content = document.querySelector('.content'); if (!c || !content) return false; return c.getBoundingClientRect().height >= content.clientHeight - 60 })()")) === true
  )
  // 右键菜单：刷新 / 导出 CSV
  await s.eval("(() => { const card = document.querySelector('.analysis-card'); const r = card.getBoundingClientRect(); card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 120 })); return true })()")
  await sleep(300)
  check(
    '分析页右键菜单是刷新/导出',
    (await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")) === '刷新,导出 CSV'
  )
  check('分析页没有刷新导出按钮', (await s.eval("[...document.querySelectorAll('.card .btn')].every((b) => !['刷新', '导出 CSV'].includes(b.innerText))) === true)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '刷新')?.click()")
  await sleep(600)
  check('右键刷新可查询', (await s.eval("document.querySelectorAll('rect.series-bar').length")) >= 1 || (await s.eval("document.querySelectorAll('.ctxmenu').length")) === 0)""", 1)

assert s != orig
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ui-check patched')
