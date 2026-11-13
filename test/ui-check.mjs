/**
 * 通过 CDP 连上真实窗口，核对界面渲染与关键交互，并截图。
 * 用法：node test/ui-check.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
/** 临时档案目录：不覆盖用户真实配置，也不与其运行中的实例抢单例锁 */
const PROFILE = mkdtempSync(join(tmpdir(), 'llmmeter-ui-'))
const DATA = join(PROFILE, 'data')
const SHOTS = join(ROOT, 'test', 'shots')
const TOKEN = 'cafebabecafebabecafebabecafebabe'
const KEY = process.env.KEY ?? 'sk-YxfyzJCnbzjFzvFCF3Fd6eE84e414dA1AcEa60B3161fE535'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

if (existsSync(SHOTS)) rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

// 造一点历史，让看板不是空的
const now = new Date()
const p = (n) => String(n).padStart(2, '0')
const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
mkdirSync(join(DATA, 'events'), { recursive: true })
mkdirSync(join(DATA, 'rollup'), { recursive: true })
const t = Date.now() - 60_000
const rows = [0, 1, 2]
  .map((i) => ({
    id: `seed-${i}`,
    ts: t + i * 5000,
    source: 'proxy',
    modelId: 'm1',
    alias: 'my-claude',
    providerId: 'p1',
    status: 200,
    ok: true,
    errorKind: null,
    stream: true,
    ttftMs: 380 + i * 10,
    durationMs: 7400,
    inputTokens: 1200,
    outputTokens: 460,
    cacheReadTokens: i === 0 ? 0 : 1080,
    cacheWriteTokens: 0,
    cost: 0.0043,
    currency: 'USD'
  }))
  // 早 3 小时再来一条，保证分析页在「近 24 小时」下有两个时间桶
  .concat({
    id: 'seed-early',
    ts: t - 3 * 3_600_000,
    source: 'proxy',
    modelId: 'm2',
    alias: 'claude-x',
    providerId: 'p2',
    status: 200,
    ok: true,
    errorKind: null,
    stream: true,
    ttftMs: 420,
    durationMs: 5200,
    inputTokens: 800,
    outputTokens: 150,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0.0021,
    currency: 'USD'
  })
writeFileSync(join(DATA, 'events', `${day}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
// 只造明细，聚合由启动时的导入从明细派生，避免两处都写导致翻倍
writeFileSync(
  join(DATA, 'config.json'),
  JSON.stringify({
    version: 1,
    providers: [
      {
        id: 'p1',
        name: '我的中转站',
        baseUrl: 'http://10.130.6.32:3001/v1',
        format: 'openai',
        keyCipher: `raw:${Buffer.from(KEY).toString('base64')}`,
        enabled: true,
        createdAt: 1
      },
      {
        id: 'p2',
        name: 'Anthropic 中转',
        baseUrl: 'https://api.anthropic.example',
        format: 'anthropic',
        keyCipher: `raw:${Buffer.from('sk-ant').toString('base64')}`,
        enabled: true,
        createdAt: 2
      }
    ],
    models: [
      {
        id: 'm1',
        providerId: 'p1',
        upstreamModel: 'DeepSeek-V4.1-Flash',
        alias: 'my-claude',
        enabled: true,
        watch: true,
        priceIn: 3,
        priceOut: 15,
        priceCacheRead: 0.3,
        priceCacheWrite: 3.75,
        currency: 'USD',
        dailyBudget: 5,
        sort: 0,
        createdAt: 1
      },
      {
        id: 'm2',
        providerId: 'p2',
        upstreamModel: 'claude-sonnet-4-5',
        alias: 'claude-x',
        enabled: true,
        watch: false,
        priceIn: 3,
        priceOut: 15,
        priceCacheRead: 0.3,
        priceCacheWrite: 3.75,
        currency: 'USD',
        dailyBudget: null,
        sort: 1,
        createdAt: 2
      }
    ],
    settings: {
      port: 8787,
      localToken: TOKEN,
      retentionDays: 30,
      rollupRetentionDays: 365,
      overlay: { x: 160, y: 160, width: 320, visible: true, modelId: 'm1' },
      overlayOpacity: 92,
      pauseProbe: false,
      startMinimized: false
    }
  }),
  'utf8'
)

// 预检：测速/流光用例依赖公司测试中继，不通时跳过而不是误报回归
const relayUp = await fetch('http://10.130.6.32:3001/v1/models', { headers: { authorization: 'Bearer ui-check' } })
  .then((r) => r.status < 500)
  .catch(() => false)
if (!relayUp) console.log('测试中继 10.130.6.32:3001 不可达，测速相关用例将跳过')

const electron = spawn(
  process.env.APP_EXE ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  process.env.APP_EXE
    ? [`--remote-debugging-port=9333`, `--user-data-dir=${PROFILE}`]
    : ['.', '--remote-debugging-port=9333', `--user-data-dir=${PROFILE}`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
)
const log = []
electron.stdout.on('data', (d) => log.push(d.toString()))
electron.stderr.on('data', (d) => log.push(d.toString()))

async function targets() {
  const res = await fetch('http://127.0.0.1:9333/json/list')
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

try {
  const main = await waitTarget('index.html')
  const s = await session(main)
  await s.send('Runtime.enable')
  for (let i = 0; i < 40; i++) {
    if (await s.eval("!!document.querySelector('.tab')")) break
    await sleep(400)
  }
  await sleep(800)

  check('主窗标题带版本', /^LLM Meter \d+\.\d+\.\d+$/.test(await s.eval('document.title')), await s.eval('document.title'))
  check('顶栏显示版本号', /v\d+\.\d+\.\d+/.test(await s.eval("document.querySelector('.brand')?.innerText ?? ''")))
  check('表头四页签齐全', (await s.eval("document.querySelectorAll('.tab').length")) === 4)
  check('汇总条已移除', (await s.eval("document.querySelectorAll('.strip').length")) === 0)
  check('曲线在表格之前', (await s.eval("document.querySelector('.section')?.firstElementChild?.className ?? ''")) === 'charts')
  check('两块曲线图', (await s.eval("document.querySelectorAll('.chart-card').length")) === 2)
  check(
    '曲线标题为 tok/s 与请求量',
    (await s.eval("[...document.querySelectorAll('.chart-title')].map((n) => n.innerText).join(',')")) === 'tok/s,请求量'
  )
  check('曲线标题不再带错误数', (await s.eval("document.querySelector('.chart-head')?.querySelector('.pill')")) === null)
  check('曲线标题右侧不再有当前值', (await s.eval("document.querySelectorAll('.chart-now').length")) === 0)
  check('模型行内没有测速中胶囊', (await s.eval("document.querySelectorAll('td.c-model .pill').length")) === 0)
  check(
    '峰值不带小数',
    !/\.\d/.test(await s.eval("document.querySelector('.chart-foot')?.innerText ?? ''"))
  )
  check('曲线图下带峰值', /峰值/.test(await s.eval("document.querySelector('.chart-foot')?.innerText ?? ''")))
  check('表头是十一列', (await s.eval("document.querySelectorAll('thead th').length")) === 11)
  const headText = await s.eval("[...document.querySelectorAll('thead th')].map((n) => n.innerText).join('|')")
  check(
    'TTFT 拆为三个分位列',
    headText.split('|').filter((x) => x.startsWith('TTFT')).join(',') === 'TTFT P50,TTFT P95,TTFT P99'
  )
  check('速率列叫 tok/s', headText.includes('|tok/s|'))
  check('表头无错误列', !(await s.eval("document.querySelector('thead').innerText")).includes('错误'))
  check('模型行渲染出来', (await s.eval("document.querySelectorAll('tbody tr.clickable').length")) >= 1)
  check('上游地址与协议列有值', (await s.eval("document.querySelector('td.c-url')?.innerText ?? ''")).includes('10.130.6.32'))
  check('曲线图已渲染', (await s.eval("document.querySelectorAll('svg.spark path.spark-line').length")) > 0)
  check('金额用人民币', /¥/.test(await s.eval("document.querySelector('td.c-cost')?.innerText ?? ''")))
  check('命中率显示为百分比', /%/.test(await s.eval("document.querySelector('td.c-hit')?.innerText ?? ''")))
  check('不再有预算条', (await s.eval("document.querySelectorAll('.meter').length")) === 0)
  check('行内没有按钮', (await s.eval("document.querySelectorAll('tbody tr.clickable button').length")) === 0)
  check('代理状态点在跑', (await s.eval("document.querySelector('.dot')?.className")) === 'dot on')
  const sandboxOk = await s.eval("typeof window.api === 'object' && typeof window.api.config === 'function'")
  check('contextIsolation 下 preload 正常暴露', sandboxOk === true)
  await s.shot('dashboard.png')

  await s.eval("document.querySelector('.tab:nth-child(3)')?.click()")
  await sleep(600)
  check('模型页列出供应商', (await s.eval("document.querySelectorAll('tbody tr').length")) >= 1)
  check('供应商与模型的状态都是可点文字按钮', (await s.eval("document.querySelectorAll('.state').length")) >= 4)
  check('模型表没有日预算列', !(await s.eval("document.querySelector('thead')?.innerText ?? ''")).includes('日预算'))
  check('供应商显示掩码 Key', /••••/.test(await s.eval("document.body.innerText")))
  check('文案已改为 OpenAI', !(await s.eval('document.body.innerText')).includes('OpenAI 兼容'))
  check(
    '悬浮窗与状态是无框文字按钮',
    (await s.eval("document.querySelectorAll('.pick').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.state').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.pick.btn, .state .pill').length")) === 0
  )
  const aligns = await s.eval(
    "[...document.querySelectorAll('.tbl-left thead th')].filter((th) => ['悬浮窗', '状态'].includes(th.innerText)).map((th) => getComputedStyle(th).textAlign).join(',')"
  )
  check('悬浮窗与状态列居中', aligns.split(',').slice(-2).join(',') === 'center,center', aligns)

  // 状态一致：点另一行「选中」，胶囊立刻跟上；随后切回 m1 保持后续断言的环境
  const ovSync = await session(await waitTarget('overlay.html'))
  await ovSync.send('Runtime.enable')
  // 已选行按钮是「● 已选」，未选是「○ 选中」，都含「选」
  const modelRows = "[...document.querySelectorAll('tbody tr')].filter((tr) => [...tr.querySelectorAll('button')].some((b) => b.innerText.includes('选')))"
  const aliases = await s.eval(`${modelRows}.map((tr) => tr.querySelector('td')?.innerText.trim() ?? '')`)
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
  ovSync.close()
  await s.shot('models.png')

  await s.eval("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(1500)
  check('分析页有范围与指标控件', (await s.eval("document.querySelectorAll('.card select').length")) === 3)
  check('分析页没有来源下拉', !(await s.eval('document.body.innerText')).includes('来源'))
  check(
    '指标只剩五项',
    (await s.eval("[...document.querySelectorAll('.card select')][1] ? [...[...document.querySelectorAll('.card select')][1].options].map((o) => o.text).join(',') : ''")) ===
      '请求数,总 token,输入 token,输出 token,成本'
  )
  check('分析页有明细表', (await s.eval("document.querySelectorAll('tbody tr').length")) >= 1)
  check('分析页画出柱状图', (await s.eval("document.querySelectorAll('rect.series-bar').length")) > 0)
  check(
    '0 值不画柱',
    await s.eval("[...document.querySelectorAll('rect.series-bar')].every((r) => Number(r.getAttribute('height')) > 1)")
  )
  check(
    '指标里有总 token，明细有对应列',
    (await s.eval("document.querySelector('.card select') ? [...document.querySelectorAll('select')].some((x) => x.innerText.includes('总 token')) : false")) &&
      (await s.eval("document.querySelector('thead')?.innerText.includes('总 token')"))
  )
  // 读数气泡要贴着悬停的柱子，不再固定右上；切到近 24 小时保证有多个桶
  await s.eval(
    "(() => { const sel = [...document.querySelectorAll('.card select')][0]; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, '24h'); sel.dispatchEvent(new Event('change', { bubbles: true })) })()"
  )
  await sleep(900)
  const svgW = await s.eval("document.querySelector('.series-svg')?.getBoundingClientRect().width ?? 0")
  const hoverAt = async (px) => {
    await s.eval(
      `(() => { const svg = document.querySelector('.series-svg'); const r = svg.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + ${px}, clientY: r.top + 120 })); })()`
    )
  }
  await hoverAt(40)
  await sleep(150)
  const tipLeft1 = await s.eval("document.querySelector('.series-tip')?.style.left ?? ''")
  const cross1 = await s.eval("document.querySelector('.series-svg .crosshair')?.getAttribute('x1') ?? ''")
  await hoverAt(Math.max(60, svgW - 40))
  await sleep(150)
  const tipLeft2 = await s.eval("document.querySelector('.series-tip')?.style.left ?? ''")
  const cross2 = await s.eval("document.querySelector('.series-svg .crosshair')?.getAttribute('x1') ?? ''")
  check(
    '读数气泡跟随柱子',
    Boolean(tipLeft1) && Boolean(tipLeft2) && tipLeft1 !== tipLeft2,
    `${tipLeft1} → ${tipLeft2} (w=${svgW}, x=${cross1}/${cross2})`
  )
  await s.eval("document.querySelector('.series-svg')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))")
  await s.eval("document.querySelector('.series-svg')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))")
  // 等首次查询结束，再跨过至少一个 5 秒轮询，按钮不应回到「查询中」
  for (let i = 0; i < 10; i++) {
    if (!(await s.eval("document.body.innerText.includes('查询中')"))) break
    await sleep(300)
  }
  let flicker = false
  for (let i = 0; i < 14; i++) {
    if (await s.eval("document.body.innerText.includes('查询中')")) flicker = true
    await sleep(500)
  }
  check('自动刷新时查询按钮不闪', !flicker)
  await s.shot('analysis.png')

  await s.eval("document.querySelector('.tab:nth-child(4)')?.click()")
  for (let i = 0; i < 20; i++) {
    if (await s.eval("!!document.querySelector('.settings-nav')")) break
    await sleep(300)
  }
  await sleep(300)
  check('设置页有四个分组', (await s.eval("document.querySelectorAll('.settings-nav button').length")) === 4)
  // 默认落在接入组
  check('设置页给出本地入口', (await s.eval("document.body.innerText")).includes('127.0.0.1'))
  check('设置页同时给出局域网入口', (await s.eval("document.body.innerText")).includes('局域网'))
  check('局域网默认关闭且置灰', (await s.eval("document.querySelectorAll('dd.dimmed').length")) === 1)
  check(
    '本地 token 是 sk- 签名票',
    /^sk-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      await s.eval("(async()=> (await window.api.config()).data?.settings.localToken ?? '')()", true)
    )
  )

  const openGroup = async (label) => {
    await s.eval(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.innerText === '${label}')?.click()`)
    await sleep(400)
  }

  await openGroup('悬浮窗')
  check('悬浮窗组有当前模型', (await s.eval("document.body.innerText")).includes('当前模型'))
  check(
    '透明度是数字输入',
    (await s.eval(
      "(() => { const f = [...document.querySelectorAll('.field')].find((n) => n.innerText.includes('不透明度')); const i = f?.querySelector('input[type=number]'); return i ? i.value : '' })()"
    )) === '92'
  )
  check(
    '透明度越界被钳到 100',
    await s.eval(`(async () => {
      const f = [...document.querySelectorAll('.field')].find((n) => n.innerText.includes('不透明度'))
      const i = f.querySelector('input[type=number]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(i, '150')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      f.querySelector('button').click()
      await new Promise((r) => setTimeout(r, 500))
      return i.value
    })()`, true) === '100'
  )

  await openGroup('运行')
  check(
    '暂停测速开关存在',
    await s.eval("[...document.querySelectorAll('input[type=checkbox]')].some((c) => c.closest('label')?.innerText.includes('暂停测速'))")
  )
  check(
    '开机自启开关存在',
    await s.eval("[...document.querySelectorAll('input[type=checkbox]')].some((c) => c.closest('label')?.innerText.includes('开机自启'))")
  )
  check(
    '汇率只展示不可改',
    !(await s.eval("[...document.querySelectorAll('.field')].some((f) => f.innerText.includes('汇率') && f.querySelector('input'))"))
  )
  check('有立即校准入口', (await s.eval("document.body.innerText")).includes('立即校准'))

  await openGroup('数据')
  check('设置页展示软件名与版本', /LLM Meter \d+\.\d+\.\d+/.test(await s.eval("document.body.innerText")))
  check('数据组有清理入口', (await s.eval("document.body.innerText")).includes('清理过期数据'))
  await s.shot('settings.png')

  await s.eval("document.querySelector('.tab:nth-child(1)')?.click()")
  for (let i = 0; i < 30; i++) {
    if (await s.eval("!!document.querySelector('tbody tr.clickable')")) break
    await sleep(300)
  }
  await s.eval("document.querySelector('tbody tr.clickable')?.scrollIntoView({ block: 'center' })")
  await sleep(500)

  // 右键行 → 菜单 → 测速
  await s.eval(
    "(() => { const tr = document.querySelector('tbody tr.clickable'); const r = tr.getBoundingClientRect(); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 60, clientY: r.top + 12 })); })()"
  )
  await sleep(500)
  check('右键弹出菜单', (await s.eval("document.querySelectorAll('.ctxmenu button').length")) === 2)
  await s.shot('ctxmenu.png')
  await s.eval("document.querySelector('.ctxmenu button')?.click()")
  await sleep(400)
  check(
    '测速中整行绿底',
    relayUp ? (await s.eval("!!document.querySelector('tr.probing')")) === true : true,
    relayUp ? '' : '跳过：测试中继不可达'
  )

  let toast = ''
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    toast = await s.eval("document.querySelector('.toast')?.innerText ?? ''")
    if (toast) break
  }
  let stillProbing = true
  for (let i = 0; i < 12; i++) {
    await sleep(400)
    stillProbing = await s.eval("!!document.querySelector('tr.probing')")
    if (!stillProbing) break
  }
  check('测速结束绿底撤掉', stillProbing === false)
  check(
    '测速给出首字与速率',
    relayUp ? /首字/.test(toast) && /tok\/s/.test(toast) : true,
    relayUp ? toast || '(没有 toast)' : '跳过：测试中继不可达'
  )
  check('测速不再报缓存结论', !/缓存/.test(toast), toast)
  await s.shot('probe.png')

  await s.eval("document.querySelector('tbody tr.clickable').click()")
  await sleep(900)
  check('点行展开明细', (await s.eval("document.querySelectorAll('.detail table tbody tr').length")) > 0)
  await s.shot('detail.png')

  // 添加模型弹窗里按 id 查价
  await s.eval("document.querySelector('.tab:nth-child(3)').click()")
  await sleep(700)
  await s.eval("[...document.querySelectorAll('button')].find((b) => b.innerText === '添加模型').click()")
  for (let i = 0; i < 20; i++) {
    if (await s.eval("!!document.querySelector('.modal input[type=\"text\"]')")) break
    await sleep(300)
  }
  await s.eval(`(() => {
    const input = document.querySelector('.modal input[type="text"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'DeepSeek-V4.1-Flash')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await s.eval("[...document.querySelectorAll('.modal button')].find((b) => b.innerText === '查价').click()")

  let note = ''
  for (let i = 0; i < 20; i++) {
    await sleep(800)
    note = await s.eval("document.querySelector('.modal p.hint')?.innerText ?? ''")
    if (note && !note.includes('查询中')) break
  }
  console.log('查价提示:', note)
  if (/超时|不可达/.test(note)) {
    check('查价失败文案统一', note === '连接openrouter超时，请手动填写', note)
  } else {
    check('查价命中并回填', /^已按照 .+ 查询并自动填写，人名币汇率为 [\d.]+/.test(note), note)
    const filled = await s.eval(`document.querySelector('.modal input[step="0.01"]')?.value ?? ''`)
    check('单价已填', Number(filled) > 0, filled)
  }
  await s.shot('price.png')

  s.close()

  const ov = await waitTarget('overlay.html')
  const o = await session(ov)
  await o.send('Runtime.enable')
  await sleep(1200)
  check('悬浮窗是胶囊且只有一个', (await o.eval("document.querySelectorAll('.capsule').length")) === 1)
  check('胶囊显示供应商与模型', (await o.eval("document.querySelector('.capsule')?.innerText ?? ''")).includes('·'))
  check(
    '胶囊只有 tok/s 与费用',
    (await o.eval("document.querySelectorAll('.capsule-metric').length")) === 1 &&
      (await o.eval("document.querySelector('.capsule-metric')?.innerText ?? ''")).includes('tok/s') &&
      !(await o.eval("document.querySelector('.capsule-metric')?.innerText ?? ''")).includes(' t/s') &&
      (await o.eval("document.querySelectorAll('.capsule-cost').length")) === 1 &&
      !(await o.eval("document.querySelector('.capsule')?.innerText ?? ''")).includes('%')
  )
  check('胶囊没有多行列表', (await o.eval("document.querySelectorAll('.orow').length")) === 0)
  check('胶囊默认黑色', (await o.eval("document.querySelector('.capsule')?.classList.contains('theme-dark')")) === true)
  await o.shot('overlay-dark.png')

  // 白色外观
  await o.eval("(async()=>await window.api.updateSettings({overlayTheme:'light'}))()")
  await sleep(800)
  check('可切白色外观', (await o.eval("document.querySelector('.capsule')?.classList.contains('theme-light')")) === true)
  await o.shot('overlay-light.png')

  // 锁定
  await o.eval("(async()=>await window.api.updateSettings({overlayLocked:true}))()")
  await sleep(800)
  check('锁定状态有标记', (await o.eval("document.querySelector('.capsule')?.classList.contains('locked')")) === true)
  check('锁定后胶囊不显示锁字', (await o.eval("!!document.querySelector('.capsule-lock')")) === false)
  check('不再有调节模式标记', (await o.eval("!!document.querySelector('.capsule.adjusting')")) === false)

  // 有请求应出彩虹边框，结束恢复（依赖测试中继，不通就跳过）
  await o.eval("window.api.runProbe('m1')")
  let rainbow = false
  if (relayUp) {
    for (let i = 0; i < 30; i++) {
      await sleep(300)
      if (await o.eval("document.querySelector('.capsule')?.classList.contains('inflight')")) {
        rainbow = true
        break
      }
    }
  }
  check('请求期间出现流光', relayUp ? rainbow : true, relayUp ? '' : '跳过：测试中继不可达')
  await o.shot('overlay-inflight.png')

  // 结束后不再固定保持 3 秒：请求一停，最迟下一个快照就该灭（最短可见只在开始侧生效）
  if (relayUp) {
    let cleared = false
    for (let i = 0; i < 120; i++) {
      await sleep(500)
      if (!(await o.eval("!!document.querySelector('.capsule.inflight')"))) {
        cleared = true
        break
      }
    }
    check('请求结束后流光熄灭', cleared)
  }
  check('缓冲过后恢复常态', (await o.eval("!!document.querySelector('.capsule.inflight')")) === false)

  const box = await o.eval("JSON.stringify({x:window.screenX,y:window.screenY,w:window.outerWidth,h:window.outerHeight})")
  const parsed = JSON.parse(box)
  check('悬浮窗尺寸非零且位置已恢复', parsed.w > 200 && parsed.h < 80 && parsed.x > 0 && parsed.y > 0, box)
  await o.shot('overlay.png')
  o.close()

  const cfgFile = JSON.parse(readFileSync(join(DATA, 'config.json'), 'utf8'))
  check('悬浮窗位置已持久化', cfgFile.settings.overlay.x > 0, `${cfgFile.settings.overlay.x},${cfgFile.settings.overlay.y}`)
  check('胶囊盯住的模型已持久化', cfgFile.settings.overlay.modelId === 'm1', String(cfgFile.settings.overlay.modelId))
} catch (err) {
  check('整体执行', false, err.message)
  console.log(log.join('').slice(-2000))
} finally {
  electron.kill()
  await sleep(600)
  if (process.env.KEEP_PROFILE) console.log('profile:', PROFILE)
  else {
    // sqlite 可能还攥着文件，退几次再放弃
    for (let i = 0; i < 6; i++) {
      try {
        rmSync(PROFILE, { recursive: true, force: true })
        break
      } catch {
        await sleep(400)
      }
    }
  }
}

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} 通过，截图在 test/shots`)
process.exit(failed ? 1 : 0)
