/**
 * 本轮界面调整的专项回归：状态点位置、失败灰行、模型名复制、局域网刷新、
 * 全软件椭圆开关、筛选记忆与列宽调整。
 * 用法：先 npm run build，再 node scripts/check/ui-followup.mjs
 * 端口可用 LLM_TEST_PORT 覆盖，默认与安装版和 ui-check 都错开。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const PROFILE = mkdtempSync(join(tmpdir(), 'llmmeter-followup-'))
const DATA = join(PROFILE, 'data')
const SHOTS = join(ROOT, 'test', 'shots')
const PORT = Number(process.env.LLM_TEST_PORT ?? 18791)
const CDP_PORT = Number(process.env.LLM_CDP_PORT ?? 9334)
const UPSTREAM_PORT = PORT + 1
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

mkdirSync(SHOTS, { recursive: true })
mkdirSync(join(DATA, 'events'), { recursive: true })
mkdirSync(join(DATA, 'rollup'), { recursive: true })
const raw = (key) => `raw:${Buffer.from(key).toString('base64')}`
writeFileSync(
  join(DATA, 'config.json'),
  JSON.stringify({
    version: 1,
    providers: [
      {
        id: 'p1',
        name: '本地上游',
        baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
        format: 'openai',
        keyCipher: raw('sk-good'),
        enabled: true,
        createdAt: 1
      },
      {
        id: 'p2',
        name: '断连上游',
        baseUrl: 'http://127.0.0.1:1/v1',
        format: 'openai',
        keyCipher: raw('sk-dead'),
        enabled: true,
        createdAt: 2
      }
    ],
    models: [
      {
        id: 'm1',
        providerId: 'p1',
        upstreamModel: 'gpt-4o-mini',
        alias: 'good-model',
        enabled: true,
        watch: true,
        showRate: true,
        priceIn: 1,
        priceOut: 2,
        priceCacheRead: 0.1,
        priceCacheInput: 0.2,
        currency: 'CNY',
        priceSource: 'manual',
        autoProbe: false,
        sort: 0,
        createdAt: 1
      },
      {
        id: 'm2',
        providerId: 'p2',
        upstreamModel: 'dead-model',
        alias: 'dead-model',
        enabled: true,
        watch: true,
        showRate: true,
        priceIn: 1,
        priceOut: 2,
        priceCacheRead: 0.1,
        priceCacheInput: 0.2,
        cacheInputSupported: false,
        currency: 'CNY',
        priceSource: 'manual',
        autoProbe: false,
        sort: 1,
        createdAt: 2
      }
    ],
    settings: {
      port: PORT,
      allowLan: true,
      retentionDays: 30,
      rollupRetentionDays: 365,
      localToken: 'cafebabecafebabecafebabecafebabe',
      overlay: { x: 180, y: 180, width: 320, visible: true, modelId: 'm1', theme: 'dark' },
      overlayOpacity: 100,
      startMinimized: false
    }
  }),
  'utf8'
)

const upstream = spawn(process.execPath, [join(ROOT, 'scripts', 'check', 'fake-upstream.mjs'), String(UPSTREAM_PORT)], {
  cwd: ROOT,
  stdio: 'ignore'
})
const electron = spawn(
  process.env.APP_EXE ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  process.env.APP_EXE
    ? [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`]
    : ['.', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
)
const log = []
electron.stdout.on('data', (d) => log.push(d.toString()))
electron.stderr.on('data', (d) => log.push(d.toString()))

async function targets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  return res.json()
}

async function waitTarget(match, timeout = 25_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try {
      const list = await targets()
      const found = list.find((t) => t.type === 'page' && t.url.includes(match))
      if (found) return found
    } catch {
      /* 等 */
    }
    await sleep(400)
  }
  throw new Error(`等不到窗口 ${match}`)
}

async function session(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.error) entry.reject(new Error(msg.error.message))
    else entry.resolve(msg.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  return {
    send,
    async eval(expr, awaitPromise = false) {
      const res = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
      return res.result.value
    },
    async shot(file) {
      const res = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(SHOTS, file), Buffer.from(res.data, 'base64'))
    },
    close: () => ws.close()
  }
}

const toastText = (s) => s.eval("[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')")
const tabSelected = async (s, n) => (await s.eval(`document.querySelector('.tab:nth-child(${n})')?.getAttribute('aria-selected')`)) === 'true'
const rowOf = (alias) =>
  `[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('${alias}'))`

try {
  const main = await waitTarget('index.html')
  const s = await session(main)
  await s.send('Runtime.enable')
  for (let i = 0; i < 40; i++) {
    if (await s.eval("!!document.querySelector('.tab')")) break
    await sleep(400)
  }
  await sleep(800)

  // 1. 仪表盘不再有状态点，模型名可复制，行别处不复制也不跳页
  check('仪表盘模型行没有状态点', (await s.eval("document.querySelectorAll('td.c-model .probe-dot').length")) === 0)
  check('模型名是复制光标', (await s.eval("getComputedStyle(document.querySelector('td.c-model .model-name')).cursor")) === 'copy')
  await s.eval("document.querySelector('td.c-model .model-name')?.click()")
  await sleep(600)
  check('点模型名复制并提示', /已复制「good-model」/.test(await toastText(s)), await toastText(s))
  const copied = await s.eval(
    "(async () => { try { return await navigator.clipboard.readText() } catch { return 'unreadable' } })()",
    true
  )
  check('剪贴板内容就是模型名', copied === 'unreadable' || copied === 'good-model', copied)
  check('点模型名不跳日志', await tabSelected(s, 1))
  const copyToasts = () =>
    s.eval("[...document.querySelectorAll('.toast')].filter((t) => /已复制|复制失败/.test(t.innerText)).length")
  for (let i = 0; i < 10; i++) {
    if ((await copyToasts()) >= 1) break
    await sleep(100)
  }
  check('点模型名只留一条复制提示', (await copyToasts()) === 1)
  await sleep(300)
  await s.eval("document.querySelector('td.c-url')?.click()")
  await sleep(500)
  check('点行别处不复制', (await copyToasts()) === 1)
  check('点行别处也不跳日志', await tabSelected(s, 1))

  // 深色下模型名条纹更收敛
  const stripeAlpha = async () => {
    const bg = await s.eval("getComputedStyle(document.querySelector('td.c-model .model-name')).backgroundImage")
    const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)
    return m ? Number(m[1]) : 1
  }
  await s.eval("document.documentElement.dataset.theme = 'dark'")
  await sleep(200)
  const darkAlpha = await stripeAlpha()
  check('深色模型底纹更淡', darkAlpha <= 0.18, String(darkAlpha))
  await s.eval("document.documentElement.dataset.theme = 'light'")
  await sleep(200)
  const lightAlpha = await stripeAlpha()
  check('浅色模型底纹保持原浓度', lightAlpha > darkAlpha, `${darkAlpha} vs ${lightAlpha}`)
  await s.eval("document.documentElement.dataset.theme = 'dark'")

  // 列宽：可抓取区域更大、常显提示、可键盘调宽
  const resizerInfo = await s.eval(
    "(() => { const r = document.querySelector('.col-resize'); const after = getComputedStyle(r, '::after'); return { w: r.getBoundingClientRect().width, bg: after.backgroundColor, focusable: r.tabIndex, role: r.getAttribute('role'), pad: getComputedStyle(r.closest('th')).paddingRight } })()"
  )
  check('列分隔条可抓取区域不小于 14px', resizerInfo.w >= 14, String(resizerInfo.w))
  check('列分隔条常显提示条', resizerInfo.bg !== 'rgba(0, 0, 0, 0)', resizerInfo.bg)
  check('列分隔条可键盘聚焦', resizerInfo.focusable === 0 && resizerInfo.role === 'separator')
  check('表头给分隔条留出空间', Number.parseFloat(resizerInfo.pad) >= 16, resizerInfo.pad)
  const thWidth = () => s.eval("document.querySelector('thead th')?.getBoundingClientRect().width ?? 0")
  const widthBeforeKey = await thWidth()
  for (let i = 0; i < 6; i++) {
    await s.eval(
      "(() => { const r = document.querySelector('.col-resize'); r?.focus(); r?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })) })()"
    )
    await sleep(150)
    if ((await thWidth()) > widthBeforeKey + 20) break
  }
  check('方向键可调宽', (await thWidth()) > widthBeforeKey + 20, `${widthBeforeKey} -> ${await thWidth()}`)
  await s.eval("document.querySelector('.col-resize')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  await sleep(200)
  const colStyle = await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
  check('双击恢复本列自动', ['', 'none', 'width: auto;'].includes(String(colStyle)))
  // 切页面保留本次运行的选择，重载（等同重启）后复位
  await s.eval(
    "(() => { const r = document.querySelector('.col-resize'); r.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })) })()"
  )
  await sleep(300)
  const keptWidth = await thWidth()
  await s.eval("document.querySelector('.tab:nth-child(3)')?.click()")
  await sleep(700)
  await s.eval("document.querySelector('.tab:nth-child(1)')?.click()")
  await sleep(700)
  check('切页面后列宽保留', Math.abs((await thWidth()) - keptWidth) < 2, `${keptWidth} -> ${await thWidth()}`)
  await s.eval('location.reload()')
  for (let i = 0; i < 40; i++) {
    try {
      if (await s.eval("document.querySelectorAll('tbody tr.clickable').length")) break
    } catch {
      /* 页面重载中 */
    }
    await sleep(300)
  }
  await sleep(500)
  check(
    '重载后列宽复位',
    Math.abs((await thWidth()) - widthBeforeKey) < 3 &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'auto',
    `${widthBeforeKey} -> ${await thWidth()}`
  )

  // 2. 断连模型：仪表盘整行变灰
  await s.eval("(async () => await window.api.runProbe('m2'))()", true)
  for (let i = 0; i < 30; i++) {
    if ((await s.eval(`${rowOf('dead-model')}?.classList.contains('row-dead')`)) === true) break
    await sleep(400)
  }
  check('断连模型的仪表盘行变灰', (await s.eval(`${rowOf('dead-model')}?.classList.contains('row-dead')`)) === true)
  check('存活模型的行不变灰', (await s.eval(`${rowOf('good-model')}?.classList.contains('row-dead')`)) === false)
  const deadOpacity = await s.eval(`getComputedStyle(${rowOf('dead-model')}?.querySelector('td')).opacity`)
  check('灰行是整行降低不透明度', Number(deadOpacity) < 0.8, deadOpacity)
  await s.shot('dashboard-gray.png')

  // 3. 模型页：状态点重回行首，失败不再靠整行底色
  await s.eval("document.querySelector('.tab:nth-child(3)')?.click()")
  await sleep(800)
  const rows = await s.eval("document.querySelectorAll('.tbl-models tbody tr').length")
  check('模型表每行前都有状态点', (await s.eval("document.querySelectorAll('.tbl-models .probe-dot').length")) === rows)
  check('断连模型的状态点是红的', (await s.eval(`${rowOf('dead-model')}?.querySelector('.probe-dot')?.classList.contains('off')`)) === true)
  check('断连模型行没有 bad-flash 底色', (await s.eval("document.querySelectorAll('.tbl-models tbody tr.bad-flash').length")) === 0)
  check('断连模型行不再整行变灰', (await s.eval(`${rowOf('dead-model')}?.classList.contains('row-dead')`)) === false)
  const resizerSpread = async (table) =>
    (await s.eval(`document.querySelectorAll('${table} thead .col-resize').length`)) ===
    (await s.eval(`document.querySelectorAll('${table} thead th').length`))
  check('模型表每列都能调宽', await resizerSpread('.tbl-models'))
  check('供应商表每列都能调宽', await resizerSpread('.card:first-child table'))
  // 让存活模型成功一次，点变绿
  await s.eval("(async () => await window.api.runProbe('m1'))()", true)
  for (let i = 0; i < 30; i++) {
    if ((await s.eval(`${rowOf('good-model')}?.querySelector('.probe-dot')?.classList.contains('on')`)) === true) break
    await sleep(400)
  }
  check('存活模型的状态点是绿的', (await s.eval(`${rowOf('good-model')}?.querySelector('.probe-dot')?.classList.contains('on')`)) === true)
  await s.shot('models-status-dot.png')

  // 4. 接入页：局域网开关为椭圆按钮，旁边有刷新
  await s.eval("document.querySelector('.tab:nth-child(4)')?.click()")
  await sleep(700)
  check('接入页局域网用椭圆开关', (await s.eval("document.querySelector('.access-half:last-child .switch[role=switch]') ? 1 : 0")) === 1)
  check('接入页没有原生勾选框', (await s.eval("document.querySelectorAll('.access-split input[type=checkbox]').length")) === 0)
  check(
    'Token 表头不再带点击复制',
    (await s.eval("document.querySelector('.tbl-access thead th:nth-child(2)')?.innerText")) === 'Token'
  )
  check(
    'Token 掩码悬停提示与仪表盘一致',
    (await s.eval("document.querySelector('.tbl-access tbody .copy-text')?.title")) === '点击复制 Token'
  )
  const alignOffsets = await s.eval(`(() => {
    const lefts = [...document.querySelectorAll('.access-cols-left dt')]
    const rights = [...document.querySelectorAll('.access-half > span')]
    return lefts.map((n, i) => Math.abs(n.getBoundingClientRect().top - rights[i].getBoundingClientRect().top))
  })()`)
  check('监听端口与本机地址对齐', (alignOffsets[0] ?? 99) <= 2, JSON.stringify(alignOffsets))
  check('局域网开关与局域网地址对齐', (alignOffsets[1] ?? 99) <= 2, JSON.stringify(alignOffsets))
  check(
    '右侧第二行没有多余竖线',
    (await s.eval("getComputedStyle(document.querySelector('.access-half:last-child')).borderLeftWidth")) === '0px'
  )
  check(
    '接入 Token 表每列都能调宽',
    (await s.eval("document.querySelectorAll('.tbl-access thead .col-resize').length")) ===
      (await s.eval("document.querySelectorAll('.tbl-access thead th').length"))
  )
  // 所有列表的表头右键都能打开「自动适应列宽」
  for (let i = 0; i < 6; i++) {
    await s.eval(
      "document.querySelector('.tbl-access thead .col-resize')?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }))"
    )
    await sleep(150)
    if ((await s.eval("getComputedStyle(document.querySelector('.tbl-access')).tableLayout")) === 'fixed') break
  }
  await s.eval(
    "document.querySelector('.tbl-access thead th')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))"
  )
  await sleep(300)
  check(
    '接入表右键有自动适应列宽',
    (await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")) ===
      '自动适应列宽'
  )
  await s.shot('col-menu.png')
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '自动适应列宽')?.click()")
  await sleep(300)
  check(
    '接入表可自动适应列宽',
    (await s.eval("getComputedStyle(document.querySelector('.tbl-access')).tableLayout")) === 'auto'
  )
  check(
    '刷新按钮在开关右侧',
    (await s.eval(
      "(() => { const half = document.querySelector('.access-half:last-child'); const sw = half?.querySelector('.switch'); const btn = [...(half?.querySelectorAll('button') ?? [])].find((b) => b.innerText === '刷新'); return !!sw && !!btn && btn.getBoundingClientRect().left >= sw.getBoundingClientRect().right - 1 })()"
    )) === true
  )
  const lanShown = await s.eval("document.querySelectorAll('.copy-text')[1]?.innerText ?? ''")
  const cardHeight = await s.eval("document.querySelector('.card').getBoundingClientRect().height")
  await s.eval("[...document.querySelectorAll('.access-half button')].find((b) => b.innerText === '刷新')?.click()")
  await sleep(900)
  check('点刷新给出提示', /局域网地址已刷新/.test(await toastText(s)), await toastText(s))
  check('刷新后仍显示局域网地址', (await s.eval("document.querySelectorAll('.copy-text')[1]?.innerText ?? ''")) === lanShown, lanShown)
  check(
    '点刷新后卡片高度不变',
    Math.abs((await s.eval("document.querySelector('.card').getBoundingClientRect().height")) - cardHeight) <= 1
  )
  await s.shot('access-refresh.png')
  const rowHeights = await s.eval(
    "[...document.querySelectorAll('.access-half')].map((h) => Math.round(h.getBoundingClientRect().height)).join(',')"
  )
  const lanRowTop = await s.eval("document.querySelector('.access-half:last-child').getBoundingClientRect().top")
  await s.eval("document.querySelector('.access-half:last-child .switch')?.click()")
  await sleep(700)
  check(
    '开关写入 allowLan=false',
    (await s.eval("(async () => (await window.api.config()).data.settings.allowLan)()", true)) === false
  )
  const rowHeightsOff = await s.eval(
    "[...document.querySelectorAll('.access-half')].map((h) => Math.round(h.getBoundingClientRect().height)).join(',')"
  )
  const lanRowTopOff = await s.eval("document.querySelector('.access-half:last-child').getBoundingClientRect().top")
  check('切换开关不改变行高', rowHeightsOff === rowHeights, `${rowHeights} -> ${rowHeightsOff}`)
  check('切换开关右侧行不上下跳', Math.abs(lanRowTopOff - lanRowTop) <= 1, `${lanRowTop} -> ${lanRowTopOff}`)
  check(
    '切换开关后卡片高度不变',
    Math.abs((await s.eval("document.querySelector('.card').getBoundingClientRect().height")) - cardHeight) <= 1
  )
  await s.eval("document.querySelector('.access-half:last-child .switch')?.click()")
  await sleep(700)
  check(
    '再点恢复 allowLan=true',
    (await s.eval("(async () => (await window.api.config()).data.settings.allowLan)()", true)) === true
  )

  // 5. 悬浮窗页与模型弹窗：全部勾选框都是椭圆开关
  await s.eval("document.querySelector('.tab:nth-child(6)')?.click()")
  await sleep(700)
  check('悬浮窗页没有原生勾选框', (await s.eval("document.querySelectorAll('input[type=checkbox]').length")) === 0)
  check('悬浮窗页每行开关都是椭圆按钮', (await s.eval("document.querySelectorAll('.setting-row .switch[role=switch]').length")) >= 5)
  const costSwitch = `[...document.querySelectorAll('.setting-row')].find((r) => r.innerText.includes('显示费用'))?.querySelector('.switch')`
  await s.eval(`${costSwitch}?.click()`)
  await sleep(700)
  check(
    '悬浮窗页开关生效',
    (await s.eval("(async () => (await window.api.config()).data.settings.overlay.showCost)()", true)) === false
  )
  await s.eval(`${costSwitch}?.click()`)
  await sleep(600)

  // 吸附屏幕中线开关
  const snapSwitch = `[...document.querySelectorAll('.setting-row')].find((r) => r.innerText.includes('吸附屏幕中线'))?.querySelector('.switch')`
  check('悬浮窗页有吸附屏幕中线开关并默认开启', (await s.eval(`${snapSwitch}?.getAttribute('aria-checked')`)) === 'true')
  const ovState = () => s.eval("(async () => (await window.api.overlayState()).data)()", true)
  const st = await ovState()
  const area = st.area
  const cx = Math.round(area.x + area.width / 2 - st.bounds.width / 2)
  const cy = Math.round(area.y + area.height / 2 - st.bounds.height / 2)
  await s.eval(`(async () => await window.api.updateSettings({ overlayX: ${cx + 6}, overlayY: ${cy + 6} }))()`, true)
  await sleep(600)
  const snapped = await ovState()
  check(
    '开启时靠近中线自动吸附',
    Math.abs(snapped.bounds.x + snapped.bounds.width / 2 - (area.x + area.width / 2)) <= 1 &&
      Math.abs(snapped.bounds.y + snapped.bounds.height / 2 - (area.y + area.height / 2)) <= 1,
    JSON.stringify(snapped.bounds)
  )
  await s.eval(`${snapSwitch}?.click()`)
  await sleep(700)
  check(
    '吸附开关可关闭并持久化',
    (await s.eval("(async () => (await window.api.config()).data.settings.overlay.snapCenter)()", true)) === false
  )
  await s.eval(`(async () => await window.api.updateSettings({ overlayX: ${cx + 6}, overlayY: ${cy + 6} }))()`, true)
  await sleep(600)
  const free = await ovState()
  check(
    '关闭后按设定位置摆放不吸附',
    Math.abs(free.bounds.x - (cx + 6)) <= 1 && Math.abs(free.bounds.y - (cy + 6)) <= 1,
    JSON.stringify(free.bounds)
  )
  await s.eval(`${snapSwitch}?.click()`)
  await sleep(600)

  await s.eval("document.querySelector('.tab:nth-child(3)')?.click()")
  await sleep(700)
  await s.eval("[...document.querySelectorAll('button')].find((b) => b.innerText === '添加模型')?.click()")
  await sleep(600)
  check('模型弹窗没有原生勾选框', (await s.eval("document.querySelectorAll('.modal input[type=checkbox]').length")) === 0)
  check(
    '模型弹窗删去上游占位与说明',
    (await s.eval("document.querySelector('.modal input.mono')?.getAttribute('placeholder')")) === null &&
      (await s.eval("[...document.querySelectorAll('.modal .field > span')].map((s) => s.innerText).join('|')")) ===
        '供应商|上游模型名|别名|输入单价 / 百万 token / ¥|输出单价 / 百万 token / ¥|缓存读取单价 / 百万 token / ¥|缓存输入单价 / 百万 token / ¥' &&
      !(await s.eval('document.querySelector(".modal")?.innerText ?? ""')).includes('新建模型的价格按手动记') &&
      !(await s.eval('document.querySelector(".modal")?.innerText ?? ""')).includes('在悬浮窗显示')
  )
  await s.eval("document.querySelector('.modal .btn')?.click()")
  await sleep(500)

  // 6. 筛选与分段选择切页后保留
  const pickRange = async (value) => {
    await s.eval(
      `(() => { const sel = document.querySelector('.range-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, '${value}'); sel.dispatchEvent(new Event('change', { bubbles: true })) })()`
    )
    await sleep(500)
  }
  await s.eval("document.querySelector('.tab:nth-child(1)')?.click()")
  await sleep(700)
  await pickRange('month')
  await s.eval("document.querySelector('.tab:nth-child(6)')?.click()")
  await sleep(600)
  await s.eval("document.querySelector('.tab:nth-child(1)')?.click()")
  await sleep(800)
  check('仪表盘区间切页后保留', (await s.eval("document.querySelector('.range-select')?.value")) === 'month')
  await pickRange('24h')

  // 分析页：活动口径与指标
  await s.eval("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(900)
  await s.eval("[...document.querySelectorAll('.seg button')].find((b) => b.innerText === '每周')?.click()")
  await s.eval(
    "(() => { const sel = [...document.querySelectorAll('.card select')][1]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, 'cost'); sel.dispatchEvent(new Event('change', { bubbles: true })) })()"
  )
  await sleep(500)
  await s.eval("document.querySelector('.tab:nth-child(6)')?.click()")
  await sleep(600)
  await s.eval("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(900)
  check(
    '活动口径切页后保留',
    (await s.eval(
      "[...document.querySelectorAll('.seg button')].find((b) => b.getAttribute('aria-selected') === 'true')?.innerText"
    )) === '每周'
  )
  check('分析指标切页后保留', (await s.eval("[...document.querySelectorAll('.card select')][1]?.value")) === 'cost')

  // 日志页：子页签与级别
  await s.eval("document.querySelector('.tab:nth-child(5)')?.click()")
  await sleep(900)
  await s.eval("[...document.querySelectorAll('.card .tab')].find((b) => b.innerText === '运行日志')?.click()")
  await sleep(500)
  await s.eval(
    "(() => { const sel = [...document.querySelectorAll('.log-filters select')].find((x) => [...x.options].some((o) => o.value === 'warn')); if (sel) { sel.value = 'warn'; sel.dispatchEvent(new Event('change', { bubbles: true })) } })()"
  )
  await sleep(500)
  await s.eval("document.querySelector('.tab:nth-child(6)')?.click()")
  await sleep(600)
  await s.eval("document.querySelector('.tab:nth-child(5)')?.click()")
  await sleep(900)
  check(
    '日志子页签切页后保留',
    (await s.eval("[...document.querySelectorAll('.card .tab')].find((b) => b.getAttribute('aria-selected') === 'true')?.innerText")) ===
      '运行日志'
  )
  check(
    '日志级别切页后保留',
    (await s.eval("[...document.querySelectorAll('.log-filters select')].find((x) => [...x.options].some((o) => o.value === 'warn'))?.value")) ===
      'warn'
  )

  s.close()
} catch (err) {
  check('整体执行', false, `${err.message}\n${err.stack ?? ''}`)
  console.log(log.join('').slice(-2000))
} finally {
  electron.kill()
  upstream.kill()
  await sleep(600)
  if (process.env.KEEP_PROFILE) console.log('profile:', PROFILE)
  else {
    for (let i = 0; i < 6; i++) {
      try {
        rmSync(PROFILE, { recursive: true, force: true })
        break
      } catch {
        await sleep(400)
      }
    }
  }
  if (existsSync(PROFILE) && process.env.KEEP_PROFILE) console.log(PROFILE)
}

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} 通过，截图在 test/shots`)
process.exit(failed ? 1 : 0)
