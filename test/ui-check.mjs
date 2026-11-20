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
    cacheInputTokens: 0,
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
    cacheInputTokens: 0,
    cost: 0.5,
    currency: 'USD'
  })
  // 早 30 小时再来一条 m2 的请求：只在「本周/本月」等更长区间里出现，用来验证区间切换真的换数据
  .concat({
    id: 'seed-old',
    ts: t - 30 * 3_600_000,
    source: 'proxy',
    modelId: 'm2',
    alias: 'claude-x',
    providerId: 'p2',
    status: 200,
    ok: true,
    errorKind: null,
    stream: true,
    ttftMs: 300,
    durationMs: 3000,
    inputTokens: 500,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheInputTokens: 0,
    cost: 0.5,
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
        priceCacheInput: 3.75,
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
        priceCacheInput: 3.75,
        cacheInputSupported: false,
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
  check('顶栏左侧不再有文字', (await s.eval("document.querySelectorAll('.brand').length")) === 0)
  check('顶栏不再显示启用模型数', !(await s.eval("document.querySelector('.status')?.innerText ?? ''")).includes('个模型启用'))
  check(
    '表头五页签齐全',
    (await s.eval("[...document.querySelectorAll('.topbar .tab')].map((t) => t.innerText).join(',')")) ===
      '仪表盘,分析,模型与供应商,接入,日志,设置'
  )
  check('汇总条已移除', (await s.eval("document.querySelectorAll('.strip').length")) === 0)
  check('曲线在表格之前', (await s.eval("document.querySelector('.section')?.firstElementChild?.className ?? ''")) === 'charts')
  check('两块曲线图', (await s.eval("document.querySelectorAll('.chart-card').length")) === 2)
  check(
    '曲线标题为速率与请求量',
    (await s.eval("[...document.querySelectorAll('.chart-title')].map((n) => n.innerText).join(',')")) === '速率,请求量'
  )
  check('两张曲线图都没有图例和峰值', (await s.eval("document.querySelectorAll('.multi-legend, .chart-foot').length")) === 0)
  check(
    '两张图上下排列、同宽',
    (await s.eval("(() => { const cards = [...document.querySelectorAll('.chart-card')]; const a = cards[0].getBoundingClientRect(); const b = cards[1].getBoundingClientRect(); return b.top > a.bottom && Math.abs(a.width - b.width) < 2 })()")) === true
  )
  const chartSizes = await s.eval("JSON.stringify([...document.querySelectorAll('.chart-card')].map((c) => ({ h: c.offsetHeight, body: c.querySelector('.chart-body')?.offsetHeight ?? 0, gap: c.getBoundingClientRect().bottom - (c.querySelector('.chart-body')?.getBoundingClientRect().bottom ?? 0) })))")
  const sizes = JSON.parse(chartSizes)
  check('两张曲线同高同版式', sizes.length === 2 && sizes[0].h === sizes[1].h && sizes[0].body === sizes[1].body && sizes[0].body >= 100, chartSizes)
  check('曲线贴近卡片底边', sizes.every((s) => s.gap <= 8), chartSizes)
  check(
    '速率图 viewBox 宽度等于桶数',
    (await s.eval("document.querySelector('.multi-svg')?.getAttribute('viewBox')?.split(' ')[2]")) === '180'
  )
  check(
    '增量曲线是折线加面积且颜色不同',
    (await s.eval("document.querySelectorAll('.multi-svg .multi-line').length")) >= 2 &&
      (await s.eval("document.querySelectorAll('.multi-svg .multi-area').length")) >= 2 &&
      (await s.eval("[...document.querySelectorAll('.multi-line')].map((l) => l.getAttribute('stroke')).filter((c, i, a) => a.indexOf(c) === i).length")) >= 2
  )
  check(
    '仪表盘模型名前有探活点',
    (await s.eval("document.querySelector('td.c-model .probe-dot') ? 1 : 0")) === 1
  )
  check(
    '模型名底纹与曲线同色且为斜纹',
    (await s.eval("document.querySelector('.multi-line')?.getAttribute('stroke') ?? ''")).includes(
      await s.eval("document.querySelector('td.c-model .model-name')?.style.getPropertyValue('--mc') ?? 'x'")
    ) &&
      /repeating-linear-gradient/.test(await s.eval("getComputedStyle(document.querySelector('td.c-model .model-name')).backgroundImage"))
  )
  check(
    '全部曲线颜色都来自别名底纹色',
    (await s.eval("(() => { const hues = [...document.querySelectorAll('td.c-model .model-name')].map((n) => n.style.getPropertyValue('--mc').trim()); return [...document.querySelectorAll('.multi-line')].every((r) => hues.includes((r.getAttribute('stroke') || '').slice(4, -1))) })()")) === true
  )
  // 仪表盘右键菜单的曲线开关
  await s.eval("(() => { const tr = document.querySelector('tbody tr.clickable'); const r = tr.getBoundingClientRect(); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 60, clientY: r.top + 12 })); return true })()")
  await sleep(300)
  const dashMenu = await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")
  check('仪表盘右键菜单含曲线开关', /^(测速),(隐藏|显示)曲线图,查看日志$/.test(dashMenu), dashMenu)
  const curvesBefore = await s.eval("document.querySelectorAll('.multi-line').length")
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText.includes('曲线图'))?.click()")
  await sleep(700)
  check('隐藏后曲线少一条', (await s.eval("document.querySelectorAll('.multi-line').length")) === curvesBefore - 1)
  await s.eval("(() => { const tr = document.querySelector('tbody tr.clickable'); const r = tr.getBoundingClientRect(); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 60, clientY: r.top + 12 })); return true })()")
  await sleep(300)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '显示曲线图')?.click()")
  await sleep(700)
  check('再显示后曲线恢复', (await s.eval("document.querySelectorAll('.multi-line').length")) === curvesBefore)
  check('曲线标题不再带错误数', (await s.eval("document.querySelector('.chart-head')?.querySelector('.pill')")) === null)
  check('曲线标题右侧有当前值', (await s.eval("document.querySelectorAll('.chart-now').length")) === 2)
  check('模型行内没有测速中胶囊', (await s.eval("document.querySelectorAll('td.c-model .pill').length")) === 0)
  check('表头是九列', (await s.eval("document.querySelectorAll('thead th').length")) === 9)
  check(
    '未上报缓存输入显示破折号',
    (await s.eval("[...document.querySelectorAll('tbody tr.clickable')].every((tr) => tr.children[6]?.innerText === '—')")) === true
  )
  const headText = await s.eval("[...document.querySelectorAll('thead th')].map((n) => n.innerText).join('|')")
  check('TTFT 三列已从仪表盘移走', headText.split('|').every((x) => !x.startsWith('TTFT')))
  check(
    '监控卡有标题与区间下拉',
    (await s.eval("[...document.querySelectorAll('.card h2')].some((h) => h.innerText === '监控')")) === true &&
      (await s.eval("document.querySelector('.range-select') ? [...document.querySelector('.range-select').options].map((o) => o.value).join(',') : ''")) ===
        'today,24h,week,month'
  )
  // 区间选项要真的换数据：30 小时前的种子只在更长的区间里出现
  const outCellOf = (alias) =>
    s.eval(`(() => { const tr = [...document.querySelectorAll('tbody tr.clickable')].find((r) => r.innerText.includes('${alias}')); return tr ? tr.children[7].innerText : '' })()`)
  const parseTok = (text) => {
    const m = /([\d.]+)\s*([kM]?)/.exec(text ?? '')
    return m ? Number(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'M' ? 1e6 : 1) : Number.NaN
  }
  const pickRange = async (value) => {
    await s.eval(`(() => { const sel = document.querySelector('.range-select'); sel.value = '${value}'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await sleep(1200)
  }
  const todayOut = parseTok(await outCellOf('claude-x'))
  await pickRange('month')
  const monthOut = parseTok(await outCellOf('claude-x'))
  check('切到本月后行数据随之变大', Number.isFinite(monthOut) && monthOut > todayOut, `${todayOut} -> ${monthOut}`)
  await pickRange('today')
  check('切回今天恢复今日口径', parseTok(await outCellOf('claude-x')) === todayOut)
  check('速率列叫 TPS', headText.includes('|TPS|'))
  check('TPS 行内没有小曲线', (await s.eval("document.querySelectorAll('td.c-rate svg').length")) === 0)
  check('表头无错误列', !(await s.eval("document.querySelector('thead').innerText")).includes('错误'))
  check('仪表盘去掉上游协议列', !headText.includes('上游协议'))
  check('模型行渲染出来', (await s.eval("document.querySelectorAll('tbody tr.clickable').length")) >= 1)
  check('供应商列只显示名字', (await s.eval("document.querySelector('td.c-url')?.innerText ?? ''")).length > 0)
  check(
    '供应商表头与值居中',
    (await s.eval("getComputedStyle(document.querySelector('th.c-url')).textAlign")) === 'center' &&
      (await s.eval("getComputedStyle(document.querySelector('td.c-url')).textAlign")) === 'center'
  )
  check('模型列只有别名一行', (await s.eval("document.querySelector('td.c-model')?.querySelectorAll('small').length")) === 0)
  check(
    '行尾有悬浮拖拽手柄',
    (await s.eval("document.querySelector('tbody tr .row-grip') ? 1 : 0")) === 1 &&
      (await s.eval("getComputedStyle(document.querySelector('tbody tr .row-grip')).position")) === 'absolute'
  )
  check(
    '表头列之间有分隔线',
    (await s.eval("(() => { const th = document.querySelectorAll('thead th')[1]; return th ? getComputedStyle(th).borderLeftWidth : '0px' })()")) === '1px'
  )
  check('整行不再 draggable', (await s.eval("document.querySelector('tbody tr.clickable')?.getAttribute('draggable')")) === null)
  // 默认自动列宽；拖动后才固定并记住
  check(
    '默认列宽自动',
    (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'auto' &&
      (await s.eval("document.querySelectorAll('table colgroup').length")) === 0
  )
  const widthBefore = await s.eval("document.querySelector('thead th')?.getBoundingClientRect().width ?? 0")
  const dragCol = async (dx) => {
    await s.eval(`(() => {
      const handle = document.querySelector('.col-resize')
      const r = handle.getBoundingClientRect()
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left }))
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + ${dx} }))
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return true
    })()`)
    await sleep(300)
  }
  await dragCol(70)
  const widthAfter = await s.eval("document.querySelector('thead th')?.getBoundingClientRect().width ?? 0")
  check('拖动表头能调列宽', widthAfter > widthBefore + 40, `${widthBefore} -> ${widthAfter}`)
  check('拖动后转成固定布局', (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'fixed')
  // 双击分隔条恢复该列自动
  await s.eval("document.querySelector('.col-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  await sleep(200)
  const resetStyle = await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
  check(
    '双击恢复单列自动',
    ['', 'none', 'width: auto;'].includes(String(resetStyle)) &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'fixed',
    String(resetStyle)
  )
  // 再拖一次供重载验证
  await dragCol(70)
  const widthFixed = await s.eval("document.querySelector('thead th')?.getBoundingClientRect().width ?? 0")
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
  const widthRestored = await s.eval("document.querySelector('thead th')?.getBoundingClientRect().width ?? 0")
  check('列宽重载后保留', Math.abs(widthRestored - widthFixed) < 3, `${widthFixed} -> ${widthRestored}`)
  // 右键表头恢复整表自动并清记录
  await s.eval("document.querySelector('thead th').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))")
  await sleep(300)
  check(
    '右键表头恢复自动并清记录',
    (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'auto' &&
      (await s.eval("localStorage.getItem('cols:dashboard')")) === null
  )
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
  check(
    '模型表没有悬浮窗与自动探针列',
    await s.eval("[...document.querySelectorAll('thead')].every((th) => !['悬浮窗', '自动探针'].some((h) => th.innerText.includes(h)))")
  )
  check(
    '模型状态是最后一列文字按钮',
    (await s.eval("[...document.querySelectorAll('.tbl-models thead th')].map((th) => th.innerText).join('|')")).endsWith('|状态') &&
      (await s.eval("document.querySelector('.tbl-models thead th:last-child').innerText")) === '状态' &&
      (await s.eval("document.querySelector('.tbl-models tbody .state')?.innerText ?? ''")) === '启用'
  )
  // 自动探针走右键菜单
  await s.eval("(() => { const tr = document.querySelector('.tbl-models tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(300)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '开启自动探针')?.click()")
  await sleep(900)
  check('开启自动探针并写入配置', await s.eval("(async () => (await window.api.config()).data.models[0].autoProbe)()", true))
  check(
    '模型表不再有探活点',
    (await s.eval("document.querySelectorAll('.tbl-models .probe-dot').length")) === 0
  )
  check('模型表别名与模型分两行', (await s.eval("document.querySelectorAll('tbody tr td .cell-model b').length")) > 0 &&
    (await s.eval("document.querySelectorAll('tbody tr td .cell-model small').length")) > 0)
  check(
    '模型名一行是灰色小字',
    (await s.eval("document.querySelector('tbody .cell-model small')?.className")) === 'mono' &&
      (await s.eval("getComputedStyle(document.querySelector('tbody .cell-model small')).color")) ===
        (await s.eval("(() => { const probe = document.createElement('span'); probe.style.color = 'var(--dim)'; document.body.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })()"))
  )
  const modelHeads = await s.eval("[...document.querySelectorAll('.tbl-models thead th')].map((th) => th.innerText).join('|')")
  check('模型表列序正确', modelHeads === '别名/模型|供应商|TTFT P50|TTFT P95|TTFT P99|输入价格|输出价格|缓存读取|缓存输入|状态')
  check('模型表有 TTFT 三列', modelHeads.includes('TTFT P50|TTFT P95|TTFT P99'))
  check(
    '不支持缓存输入的模型价显示破折号',
    (await s.eval("[...document.querySelectorAll('.tbl-models tbody tr')].find((tr) => tr.innerText.includes('claude-x'))?.children[8]?.innerText")) === '—'
  )
  check('模型行内没有编辑删除按钮', (await s.eval("[...document.querySelectorAll('.tbl-models tbody button')].some((b) => ['编辑', '删除'].includes(b.innerText))")) === false)
  check('模型表每列都有调宽手柄', (await s.eval("document.querySelectorAll('.tbl-models thead .col-resize').length")) === 10)
  check('模型行尾有悬浮拖拽手柄', (await s.eval("document.querySelector('.tbl-models tbody tr .row-grip') ? 1 : 0")) === 1)
  check(
    '模型表拖拽手柄可见且不占列',
    (await s.eval("document.querySelector('.tbl-models tbody tr .row-grip')?.getBoundingClientRect().width ?? 0")) >= 10
  )
  check('供应商表每列都有调宽手柄', (await s.eval("document.querySelectorAll('.card:first-child thead .col-resize').length")) === 5)
  // 右键菜单：关闭该行后整行变灰，再开启恢复
  const rowsBeforeMenu = await s.eval("document.querySelectorAll('.tbl-models tbody tr').length")
  await s.eval("(() => { const tr = document.querySelector('.tbl-models tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(300)
  const menuItems = await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")
  check(
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
  check('再点状态恢复', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === false)
  // 拖动排序：把第一行拖到第二行位置
  const aliasBefore = await s.eval("[...document.querySelectorAll('.tbl-models tbody .cell-model b')].map((b) => b.innerText).join(',')")
  await s.eval("window.__dt = new DataTransfer(); (() => { const rows = document.querySelectorAll('.tbl-models tbody tr'); rows[0].querySelector('.grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt })); return true })()")
  await sleep(100)
  check('拖动开始有拖拽样式', (await s.eval("document.querySelectorAll('.tbl-models tbody tr.dragging').length")) === 1)
  check('dataTransfer 带上模型 id', (await s.eval("window.__dt.getData('text/plain')")) === 'm1')
  await s.eval("window.__ev = []; document.addEventListener('dragstart', (e) => window.__ev.push('start:' + e.target.tagName), true); document.addEventListener('dragover', (e) => window.__ev.push('over:' + e.target.tagName), true); document.addEventListener('drop', (e) => window.__ev.push('drop:' + e.target.tagName), true)")
  await s.eval("(() => { const rows = document.querySelectorAll('.tbl-models tbody tr'); rows[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: window.__dt })); rows[1].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.__dt })); return true })()")
  await sleep(900)
  check('drop 事件到达行', (await s.eval("window.__ev.join(',')")).includes('drop:TR'), await s.eval("window.__ev.join(',')"))
  const aliasAfter = await s.eval("[...document.querySelectorAll('.tbl-models tbody .cell-model b')].map((b) => b.innerText).join(',')")
  const aliasList = aliasBefore.split(',')
  const aliasExpected = [aliasList[1], aliasList[0], ...aliasList.slice(2)].join(',')
  check('拖动后顺序交换', aliasAfter === aliasExpected, `${aliasBefore} -> ${aliasAfter}`)
  // 再拖回来，后续用例仍按原顺序假设
  await s.eval("window.__dt2 = new DataTransfer(); (() => { const rows = document.querySelectorAll('.tbl-models tbody tr'); rows[0].querySelector('.grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt2 })); return true })()")
  await sleep(100)
  await s.eval("(() => { const rows = document.querySelectorAll('.tbl-models tbody tr'); rows[1].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.__dt2 })); return true })()")
  await sleep(900)
  check('拖回原顺序', (await s.eval("[...document.querySelectorAll('.tbl-models tbody .cell-model b')].map((b) => b.innerText).join(',')")) === aliasBefore)
  check('模型表没有日预算列', !(await s.eval("document.querySelector('thead')?.innerText ?? ''")).includes('日预算'))
  check('供应商显示掩码 Key', /••••/.test(await s.eval("document.body.innerText")))
  // 供应商行的右键菜单：测试/编辑/删除
  await s.eval("(() => { const tr = document.querySelector('.card:first-child tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(300)
  check(
    '供应商右键菜单是测试/编辑/删除',
    (await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")) === '测试,编辑,删除'
  )
  await s.eval("document.body.click()")
  await sleep(200)
  check('文案已改为 OpenAI', !(await s.eval('document.body.innerText')).includes('OpenAI 兼容'))
  check(
    '状态是无框文字按钮',
    (await s.eval("document.querySelectorAll('.state').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.state.pill, .state.btn').length")) === 0,
    `state=${await s.eval("document.querySelectorAll('.state').length")} pillbtn=${await s.eval("document.querySelectorAll('.state.pill, .state.btn').length")} rows=${await s.eval("document.querySelectorAll('.tbl-models tbody tr').length")} body=${await s.eval("document.querySelector('.content')?.innerText.slice(0,80)")}`
  )
  check(
    '状态列居中',
    (await s.eval("(() => { const th = [...document.querySelectorAll('.tbl-models thead th')].find((x) => x.innerText === '状态'); return th ? getComputedStyle(th).textAlign : '' })()")) === 'center'
  )

  // 状态一致：右键第二行「显示在悬浮窗」，胶囊立刻跟上；再切回 m1
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
  ovSync.close()
  await s.shot('models.png')

  // 接入页：地址点击复制、端口、多 token（备注必填）、局域网开关
  await s.eval("document.querySelector('.tab:nth-child(4)')?.click()")
  for (let i = 0; i < 20; i++) {
    if (await s.eval("!!document.querySelector('.copy-text')")) break
    await sleep(300)
  }
  check('接入页在本机地址可点击复制', (await s.eval("document.querySelector('.copy-text')?.innerText ?? ''")).includes('127.0.0.1'))
  await s.eval("document.querySelector('.copy-text')?.click()")
  await sleep(800)
  check('点地址有复制反馈', /复制/.test(await s.eval("[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')")))
  check('默认至少一个 token 且掩码显示', (await s.eval("document.querySelectorAll('.copy-text.mono').length")) >= 2)
  check('接入页不显示说明文字', !(await s.eval("document.body.innerText")).includes('点地址即可复制'))
  // 生成弹窗：空备注被拒
  await s.eval("[...document.querySelectorAll('button')].find((b) => b.innerText === '生成 Token')?.click()")
  await sleep(300)
  check('生成按钮弹出备注框', (await s.eval("document.querySelectorAll('.modal input').length")) === 1)
  await s.eval("document.querySelector('.modal .btn.primary')?.click()")
  await sleep(400)
  check('空备注不能生成', /备注必须填写/.test(await s.eval("[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')")))
  // 带备注生成
  await s.eval(`(() => {
    const input = document.querySelector('.modal input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '测试备注')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await s.eval("document.querySelector('.modal .btn.primary')?.click()")
  await sleep(800)
  check('生成后弹窗关闭', (await s.eval("document.querySelectorAll('.modal').length")) === 0)
  check(
    '备注 token 生成成功',
    /测试备注/.test(await s.eval("document.querySelector('.tbl-access tbody')?.innerText ?? ''")) &&
      (await s.eval("(async () => (await window.api.config()).data.settings.tokens.some((t) => t.remark === '测试备注'))()", true)),
    await s.eval("[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')")
  )
  check('token 是 sk- 加十六进制', (await s.eval("(async () => (await window.api.config()).data.settings.tokens.every((t) => /^sk-[0-9a-f]{32}$/.test(t.token)))()", true)) === true)
  check('token 列表全部左对齐', (await s.eval("[...document.querySelectorAll('.tbl-access th, .tbl-access td')].every((n) => getComputedStyle(n).textAlign === 'left')")) === true)
  check('token 行内没有删除按钮', (await s.eval("[...document.querySelectorAll('.tbl-access tbody button')].length")) === 0)
  // 行右键：修改备注、删除
  await s.eval("(() => { const tr = [...document.querySelectorAll('.tbl-access tbody tr')].find((r) => r.innerText.includes('测试备注')); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 80 })); return true })()")
  await sleep(300)
  check('token 右键菜单有修改与删除', (await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")) === '修改备注,删除')
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '修改备注')?.click()")
  await sleep(300)
  check('修改弹窗回填旧备注', (await s.eval("document.querySelector('.modal input')?.value")) === '测试备注')
  await s.eval(`(() => {
    const input = document.querySelector('.modal input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '测试备注2')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await s.eval("document.querySelector('.modal .btn.primary')?.click()")
  await sleep(800)
  check('备注修改成功', /测试备注2/.test(await s.eval("document.querySelector('.tbl-access tbody')?.innerText ?? ''")), `toasts=${await s.eval("[...document.querySelectorAll('.toast')].map((t) => t.innerText).join('|')")} modal=${await s.eval("document.querySelector('.modal') ? 'open' : 'closed'")}`)
  await s.eval("(() => { const tr = [...document.querySelectorAll('.tbl-access tbody tr')].find((r) => r.innerText.includes('测试备注2')); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 80 })); return true })()")
  await sleep(300)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '删除')?.click()")
  await sleep(500)
  // 端口与局域网同一行分两半
  check(
    '端口与局域网上下排布',
    (await s.eval("(() => { const hs = document.querySelectorAll('.access-cols-right .access-half'); if (hs.length !== 2) return false; const a = hs[0].getBoundingClientRect(); const b = hs[1].getBoundingClientRect(); return b.top > a.bottom - 2 && Math.abs(a.left - b.left) < 2 })()")) === true
  )
  check(
    '端口与局域网已并入地址卡右侧',
    (await s.eval("document.querySelectorAll('.access-split .access-half').length")) === 2 &&
      (await s.eval("document.querySelector('.access-cols-right .access-split .access-half:first-child input[type=number]') ? 1 : 0")) === 1 &&
      (await s.eval("document.querySelector('.access-cols-right .access-split .access-half:last-child input[type=checkbox]') ? 1 : 0")) === 1 &&
      (await s.eval("!!document.querySelector('.access-cols-left .copy-text')")) === true
  )
  await s.eval("document.querySelector('.access-split input[type=checkbox]')?.click()")
  for (let i = 0; i < 20; i++) {
    if (await s.eval("document.body.innerText.includes('局域网地址')")) break
    await sleep(300)
  }
  check('开启局域网后接入页出现局域网地址', (await s.eval("document.body.innerText")).includes('局域网地址'))
  await s.eval("document.querySelector('.access-split input[type=checkbox]')?.click()")
  for (let i = 0; i < 20; i++) {
    if (!(await s.eval("document.body.innerText.includes('局域网地址')"))) break
    await sleep(300)
  }

  await s.eval("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(1500)
  check('分析页有范围与指标控件', (await s.eval("document.querySelectorAll('.card select').length")) === 3)
  check('分析筛选没有文字标签', (await s.eval("document.querySelectorAll('.ana-head .field > span').length")) === 0)
  check(
    '图表卡头无标题、控件顶在左上',
    (await s.eval("[...document.querySelectorAll('.card h2')].every((x) => x.innerText !== '请求数')")) === true &&
      (await s.eval("(() => { const card = document.querySelector('.ana-head')?.closest('.card'); const sel = document.querySelector('.ana-head select'); if (!card || !sel) return false; const c = card.getBoundingClientRect(); const r = sel.getBoundingClientRect(); return r.top - c.top < 90 && r.left - c.left < 130 })()")) === true
  )
  check('分析页没有来源下拉', !(await s.eval('document.body.innerText')).includes('来源'))
  check(
    '指标有六项',
    (await s.eval("[...document.querySelectorAll('.card select')][1] ? [...[...document.querySelectorAll('.card select')][1].options].map((o) => o.text).join(',') : ''")) ===
      '请求数,总 token,总输入 token,未缓存输入 token,输出 token,成本'
  )
  check(
    '分组含 Token 备注',
    (await s.eval("[...document.querySelectorAll('.card select')][2] ? [...[...document.querySelectorAll('.card select')][2].options].map((o) => o.value).join(',') : ''")) ===
      'model,provider,token'
  )
  // 切到按 token 备注分组：表头与行标签都换成备注
  await s.eval(`(() => {
    const sel = [...document.querySelectorAll('.card select')][2]
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'token')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1200)
  await s.eval(`(() => {
    const sel = [...document.querySelectorAll('.card select')][2]
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'model')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1200)
  for (let i = 0; i < 20; i++) {
    if (await s.eval("document.querySelectorAll('rect.series-bar').length")) break
    await sleep(300)
  }
  check('分析页画出柱状图', (await s.eval("document.querySelectorAll('rect.series-bar').length")) > 0)
  check('空时段也保留时间刻度', (await s.eval("document.querySelectorAll('.series-svg text.axis').length")) >= 2)
  check(
    '0 值不画柱',
    await s.eval("[...document.querySelectorAll('rect.series-bar')].every((r) => Number(r.getAttribute('height')) > 1)")
  )
  check(
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
  check('分析页没有刷新导出按钮', (await s.eval("[...document.querySelectorAll('.card .btn')].every((b) => !['刷新', '导出 CSV'].includes(b.innerText))")) === true)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '刷新')?.click()")
  await sleep(600)
  check('右键刷新可查询', (await s.eval("document.querySelectorAll('rect.series-bar').length")) >= 1 || (await s.eval("document.querySelectorAll('.ctxmenu').length")) === 0)
  // 读数气泡要贴着悬停的柱子，不再固定右上；切到近 24 小时保证有多个桶
  await s.eval(
    "(() => { const sel = [...document.querySelectorAll('.card select')][0]; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, '24h'); sel.dispatchEvent(new Event('change', { bubbles: true })) })()"
  )
  await sleep(1600)
  for (let i = 0; i < 20; i++) {
    if (await s.eval("!!document.querySelector('.series-svg')")) break
    await sleep(300)
  }
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

  await s.eval("document.querySelector('.tab:nth-child(6)')?.click()")
  for (let i = 0; i < 20; i++) {
    if (await s.eval("!!document.querySelector('.settings-cards')")) break
    await sleep(300)
  }
  await sleep(300)
  check('设置页按职责分成五张卡片', (await s.eval("[...document.querySelectorAll('.settings-cards .card h2')].map((h) => h.innerText).join(',')")) === '外观,悬浮窗,启动,探针与校准,数据')
  // 主题：切成深色后 html 带 data-theme=dark，背景变量变深；切回跟随系统
  await s.eval("(async()=>await window.api.updateSettings({theme:'dark'}))()")
  await sleep(500)
  check('切深色后页面变深色', (await s.eval("document.documentElement.dataset.theme")) === 'dark' &&
    (await s.eval("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()")) === '#14171c')
  await s.eval("(async()=>await window.api.updateSettings({theme:'system'}))()")
  await sleep(300)
  check('切回跟随系统', (await s.eval("['dark','light'].includes(document.documentElement.dataset.theme ?? '')")) === true)
  check('设置页不再有左导航', (await s.eval("document.querySelectorAll('.settings-nav').length")) === 0)
  check(
    '设置卡片随窗口撑满',
    await s.eval("(() => { const c = document.querySelector('.settings-cards .card'); const content = document.querySelector('.content'); return c && Math.abs(c.getBoundingClientRect().width - (content.clientWidth - 36)) < 2 })()")
  )
  check(
    '应用按钮留在卡片内',
    await s.eval("(() => { const card = [...document.querySelectorAll('.settings-cards .card')].find((c) => c.innerText.includes('不透明度')); const btn = [...card.querySelectorAll('.btn')].find((b) => b.innerText === '应用'); return btn && btn.getBoundingClientRect().right <= card.getBoundingClientRect().right - 8 && btn.getBoundingClientRect().width > 30 })()")
  )
  check('设置项按行排布', (await s.eval("document.querySelectorAll('.setting-row').length")) >= 7)
  check('端口与局域网已不在设置页', !(await s.eval("document.body.innerText")).includes('监听端口') && !(await s.eval("document.body.innerText")).includes('允许局域网访问'))
  check('右上角不再显示 IP 地址', (await s.eval("document.querySelectorAll('.status .mono').length")) === 0)
  check('悬浮窗卡片有当前模型', (await s.eval("document.body.innerText")).includes('当前模型'))
  check(
    '设置页当前模型可显示全局',
    (await s.eval(
      `(async () => {
        await window.api.updateSettings({ overlayGlobal: true })
        // 直接调 API 不会刷新 config prop，借一次复选框点击触发 reload
        const flag = [...document.querySelectorAll('.setting-row')].find((n) => n.innerText.includes('显示费用'))
        const box = flag.querySelector('input[type=checkbox]')
        box.click()
        await new Promise((r) => setTimeout(r, 700))
        const row = [...document.querySelectorAll('.setting-row')].find((n) => n.innerText.includes('当前模型'))
        const txt = row?.innerText ?? ''
        box.click()
        await new Promise((r) => setTimeout(r, 400))
        await window.api.updateSettings({ overlayGlobal: false })
        await new Promise((r) => setTimeout(r, 300))
        return txt.includes('全局')
      })()`,
      true
    )) === true
  )
  check(
    '悬浮窗卡片有显示内容开关',
    await s.eval(
      "['显示供应商名称', '显示模型名称', '显示费用'].every((t) => [...document.querySelectorAll('.setting-row')].some((r) => r.innerText.includes(t)))"
    )
  )
  check(
    '设置页可关费用并持久化',
    (await s.eval(
      `(async () => {
        const f = [...document.querySelectorAll('.setting-row')].find((n) => n.innerText.includes('显示费用'))
        const i = f.querySelector('input[type=checkbox]')
        i.click()
        await new Promise((r) => setTimeout(r, 600))
        const off = (await window.api.config()).data?.settings.overlay.showCost
        i.click()
        await new Promise((r) => setTimeout(r, 400))
        const on = (await window.api.config()).data?.settings.overlay.showCost
        return off === false && on === true
      })()`,
      true
    )) === true
  )
  check(
    '设置页有位置像素输入并生效',
    (await s.eval(
      `(async () => {
        const f = [...document.querySelectorAll('.setting-row')].find((n) => n.innerText.includes('位置 X / Y'))
        const inputs = f?.querySelectorAll('input[type=number]') ?? []
        if (inputs.length !== 2) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(inputs[0], '321')
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
        setter.call(inputs[1], '322')
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
        f.querySelector('button').click()
        await new Promise((r) => setTimeout(r, 700))
        const ov = (await window.api.config()).data?.settings.overlay
        return ov?.x === 321 && ov?.y === 322
      })()`,
      true
    )) === true
  )
  check(
    '透明度是数字输入',
    (await s.eval(
      "(() => { const f = [...document.querySelectorAll('.setting-row')].find((n) => n.innerText.includes('不透明度')); const i = f?.querySelector('input[type=number]'); return i ? i.value : '' })()"
    )) === '92'
  )
  check(
    '透明度越界被钳到 100',
    await s.eval(`(async () => {
      const f = [...document.querySelectorAll('.setting-row')].find((n) => n.innerText.includes('不透明度'))
      const i = f.querySelector('input[type=number]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(i, '150')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      f.querySelector('button').click()
      await new Promise((r) => setTimeout(r, 500))
      return i.value
    })()`, true) === '100'
  )
  check(
    '开机自启与只留托盘开关存在',
    (await s.eval("document.body.innerText")).includes('开机自启') && (await s.eval("document.body.innerText")).includes('只留托盘')
  )
  check(
    '自动探针间隔是数字输入',
    (await s.eval("[...document.querySelectorAll('.setting-row')].filter((f) => f.innerText.includes('自动探针间隔')).length")) === 1
  )
  check('设置页不再显示当前汇率', !(await s.eval("document.body.innerText")).includes('当前汇率'))
  check('设置页不再显示上次校准', !(await s.eval("document.body.innerText")).includes('上次校准'))
  check('设置页没有立即校准按钮', !(await s.eval("document.body.innerText")).includes('立即校准'))
  check(
    '保留自动校准开关',
    await s.eval("[...document.querySelectorAll('input[type=checkbox]')].some((c) => c.closest('label')?.innerText.includes('自动校准'))")
  )
  check('设置页展示软件名与版本', /LLM Meter \d+\.\d+\.\d+/.test(await s.eval("document.body.innerText")))
  check('数据卡片有清理入口', (await s.eval("document.body.innerText")).includes('清理过期数据'))
  await s.eval("document.querySelector('.content').scrollTop = 2000")
  await sleep(300)
  check('滚动后顶栏仍在', (await s.eval("document.querySelector('.topbar')?.getBoundingClientRect().top")) === 0)
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
  check('右键弹出菜单', (await s.eval("document.querySelectorAll('.ctxmenu button').length")) === 3)
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
  check(
    '表格 TPS 列显示上一条速率',
    relayUp ? /^\d+$/.test(await s.eval("document.querySelector('td.c-rate')?.innerText ?? ''")) : true,
    relayUp ? '' : '跳过：测试中继不可达'
  )
  await s.shot('probe.png')

  // 点行直接跳日志页并按该模型过滤
  const clickedAlias = await s.eval("document.querySelector('tbody tr.clickable td.c-model')?.innerText ?? ''")
  const preClick = await s.eval("document.querySelectorAll('tbody tr.clickable').length + '/' + document.querySelector('.content')?.innerText.slice(0, 120)")
  check('测速后行仍在', (await s.eval("document.querySelectorAll('tbody tr.clickable').length")) > 0, preClick)
  await s.eval("document.querySelector('tbody tr.clickable')?.click()")
  await sleep(900)
  check('点行跳到日志页', (await s.eval("document.querySelector('.tab:nth-child(5)')?.getAttribute('aria-selected')")) === 'true')
  const logModel = await s.eval("[...document.querySelectorAll('.log-filters select')].find((x) => x.options[0]?.value === '')?.value ?? ''")
  check('日志页按所点模型过滤', logModel !== '', clickedAlias)
  check('日志筛选没有文字标签', (await s.eval("[...document.querySelectorAll('.field > span')].filter((x) => ['时间范围','模型','来源','结果','级别','关键字'].includes(x.innerText)).length")) === 0)
  check('请求日志表没有备注列', !(await s.eval("document.querySelector('.tbl-log thead')?.innerText ?? ''")).includes('备注'))
  const requestRows = await s.eval("document.querySelectorAll('.tbl-log tbody tr').length")
  const alignInfo = await s.eval("(() => { const th = [...document.querySelectorAll('.tbl-request thead th')].map((x) => getComputedStyle(x).textAlign).join(','); const td = [...document.querySelectorAll('.tbl-request tbody td')].map((x) => getComputedStyle(x).textAlign).join(','); return th + ' | ' + td })()")
  check(
    '请求日志有行且表头与值全部居中',
    requestRows > 0 &&
      (await s.eval("document.querySelector('.tbl-log thead')?.innerText ?? ''")).includes('来源') &&
      (await s.eval("[...document.querySelectorAll('.tbl-request thead th')].every((th) => getComputedStyle(th).textAlign === 'center')")) &&
      (await s.eval("[...document.querySelectorAll('.tbl-request tbody td')].every((td) => getComputedStyle(td).textAlign === 'center')")),
    `${requestRows} 行 | ${alignInfo}`
  )
  // 关键字过滤：填一个不可能命中的词
  await s.eval(`(() => {
    const input = document.querySelector('.log-filters input[type="text"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'zzz-not-exist')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...document.querySelectorAll('.log-filters button')].find((b) => b.innerText === '查询')?.click()
    return true
  })()`)
  await sleep(700)
  check('关键字过滤生效', (await s.eval("document.querySelector('.tbl-log tbody tr') ? 0 : 1")) === 1)
  // 来源筛选为探针
  await s.eval(`(() => {
    const input = document.querySelector('.log-filters input[type="text"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...document.querySelectorAll('.log-filters button')].find((b) => b.innerText === '查询')?.click()
    const sel = [...document.querySelectorAll('.log-filters select')].find((x) => [...x.options].some((o) => o.value === 'probe'))
    sel.value = 'probe'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(700)
  check(
    '来源筛选只剩探针',
    await s.eval("document.querySelector('.tbl-log tbody tr') ? [...document.querySelectorAll('.tbl-log tbody tr')].every((tr) => tr.innerText.includes('探针')) : true")
  )
  // 运行日志页有启动记录，且可筛选级别
  await s.eval("document.querySelector('.card .tab:nth-child(2)')?.click()")
  await sleep(800)
  check('运行日志有内容', (await s.eval("document.querySelectorAll('.tbl-log tbody tr').length")) > 0)
  check('运行日志有启动范围', (await s.eval("document.querySelector('.tbl-log')?.innerText ?? ''")).includes('startup'))
  check('运行日志可筛选级别', (await s.eval("[...document.querySelectorAll('.log-filters select')].some((x) => [...x.options].some((o) => o.value === 'warn'))")) === true)
  check('有立即校准入口', (await s.eval("document.body.innerText")).includes('立即校准'))
  await s.shot('logs.png')

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
    check('查价命中并回填', /^已按照 .+ 查询并自动填写（(官方价|OpenRouter 最低服务商价)），人民币汇率为 [\d.]+/.test(note), note)
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
    '胶囊最多一个 tok/s 指标加费用',
    (await o.eval("document.querySelectorAll('.capsule-metric').length")) <= 1 &&
      (await o.eval("[...document.querySelectorAll('.capsule-metric')].every((n) => n.innerText.includes('tok/s') && !n.innerText.includes(' t/s'))")) &&
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

  // 显示内容三项各自可关：关掉立即消失，再开恢复
  const capText = () => o.eval("document.querySelector('.capsule')?.innerText ?? ''")
  await o.eval("(async()=>await window.api.updateSettings({overlayShowProvider:false}))()")
  await sleep(800)
  check(
    '可关供应商名称',
    !(await capText()).includes('我的中转站') &&
      (await o.eval("document.querySelectorAll('.capsule-sep').length")) === 0 &&
      (await capText()).includes('my-claude')
  )
  await o.eval("(async()=>await window.api.updateSettings({overlayShowModel:false}))()")
  await sleep(800)
  check(
    '可关模型名称',
    !(await capText()).includes('my-claude') && (await o.eval("document.querySelectorAll('.capsule-name').length")) === 0
  )
  await o.eval("(async()=>await window.api.updateSettings({overlayShowCost:false}))()")
  await sleep(800)
  check('可关费用', (await o.eval("document.querySelectorAll('.capsule-cost').length")) === 0)
  check('三项全关只剩状态点', (await o.eval("document.querySelectorAll('.capsule-dot').length")) === 1)
  check(
    '三项全关后胶囊收窄贴合内容',
    parseFloat(await o.eval("document.querySelector('.capsule')?.getBoundingClientRect().width ?? 999")) < 140
  )
  await o.shot('overlay-minimal.png')
  await o.eval(
    "(async()=>await window.api.updateSettings({overlayShowProvider:true,overlayShowModel:true,overlayShowCost:true}))()"
  )
  await sleep(800)
  check(
    '显示内容三项可恢复',
    (await capText()).includes('我的中转站') &&
      (await capText()).includes('my-claude') &&
      (await o.eval("document.querySelectorAll('.capsule-cost').length")) === 1
  )

  // 状态点跟选中模型走：未探过灰 → 探活失败红；切回探活成功的 m1 变绿
  const dotClass = () => o.eval("document.querySelector('.capsule-dot')?.className ?? ''")
  await o.eval("(async()=>await window.api.updateSettings({overlayModelId:'m2'}))()")
  await sleep(900)
  check('未探活的模型状态点为灰', !(await dotClass()).includes(' on') && !(await dotClass()).includes(' off'), await dotClass())
  // 点跟自动探活结果走：给不可达的 m2 开自动探针，等它探失败变红（每 5 秒一轮 + 15 秒超时）
  await o.eval("(async()=>await window.api.updateModel('m2', {autoProbe:true}))()", true)
  for (let i = 0; i < 90; i++) {
    if ((await dotClass()).includes(' off')) break
    await sleep(500)
  }
  check('探活失败的模型状态点为红', (await dotClass()).includes(' off'), await dotClass())
  await o.eval("(async()=>await window.api.updateModel('m2', {autoProbe:false}))()", true)
  await o.eval("(async()=>await window.api.updateSettings({overlayModelId:'m1'}))()")
  await sleep(900)
  check(
    '探活成功的模型状态点为绿',
    relayUp ? (await dotClass()).includes(' on') : true,
    relayUp ? await dotClass() : '跳过：测试中继不可达'
  )

  // 全局模式：名称固定「全局 · 全部模型」，费用为合计，状态点按聚合健康（m2 刚失败应为红）
  const costText = () => o.eval("document.querySelector('.capsule-cost')?.innerText ?? '∅'")
  const costValue = async () => Number((await costText()).replace(/[^\d.]/g, ''))
  const singleCost = await costValue()
  const singleCostText = await costText()
  await o.eval("(async()=>await window.api.updateSettings({overlayGlobal:true}))()")
  await sleep(900)
  check('可切全局数据', (await capText()).includes('全局') && (await capText()).includes('Σ'))
  check(
    '全局费用是各模型之和',
    (await costValue()) > singleCost,
    `${singleCostText} -> ${await costText()}`
  )
  check('全局状态点聚合失败为红', (await dotClass()).includes(' off'))
  await o.shot('overlay-global.png')
  await o.eval("(async()=>await window.api.updateSettings({overlayGlobal:false}))()")
  await sleep(800)
  check('可切回单模型', (await capText()).includes('my-claude') && !(await capText()).includes('Σ'))

  // 位置按像素设定、宽度以中心生长、贴边时贴边侧不动、吸附开关可持久化
  const stateOf = () => o.eval("(async()=> (await window.api.overlayState()).data)()", true)
  const st0 = await stateOf()
  const area = st0.area
  const cx = area.x + 400
  const cy = area.y + 300
  await o.eval(`(async()=>await window.api.updateSettings({overlayX:${cx}, overlayY:${cy}}))()`)
  await sleep(500)
  const place = await stateOf()
  check('按像素设定位置生效', Math.abs(place.bounds.x - cx) <= 1 && Math.abs(place.bounds.y - cy) <= 1, JSON.stringify(place.bounds))
  const centerBefore = place.bounds.x + place.bounds.width / 2
  await o.eval("(async()=>await window.api.updateSettings({overlayShowProvider:false}))()")
  await sleep(900)
  const shrunk = await stateOf()
  const centerAfter = shrunk.bounds.x + shrunk.bounds.width / 2
  check(
    '宽度变化以中心为轴',
    shrunk.bounds.width !== place.bounds.width && Math.abs(centerAfter - centerBefore) <= 3,
    `${centerBefore} -> ${centerAfter}`
  )
  await o.eval("(async()=>await window.api.updateSettings({overlayShowProvider:true}))()")
  await sleep(800)
  const rightX = area.x + area.width - (await stateOf()).bounds.width
  await o.eval(`(async()=>await window.api.updateSettings({overlayX:${rightX}, overlayY:${area.y + 200}}))()`)
  await sleep(500)
  const edge0 = (await stateOf()).bounds
  check('可以贴到右缘', Math.abs(edge0.x + edge0.width - (area.x + area.width)) <= 1, JSON.stringify(edge0))
  await o.eval("(async()=>await window.api.updateSettings({overlayShowCost:false}))()")
  await sleep(900)
  const edge1 = (await stateOf()).bounds
  check('贴右缘时变窄右缘不动', Math.abs(edge1.x + edge1.width - (area.x + area.width)) <= 1, JSON.stringify(edge1))
  await o.eval("(async()=>await window.api.updateSettings({overlayShowCost:true}))()")
  await sleep(700)
  await o.eval("(async()=>await window.api.updateSettings({overlaySnapEdges:false}))()")
  await sleep(300)
  check(
    '吸附开关可持久化',
    (await o.eval("(async()=> (await window.api.config()).data?.settings.overlay.snapEdges)()", true)) === false
  )
  await o.eval("(async()=>await window.api.updateSettings({overlaySnapEdges:true}))()")

  // 锁定
  await o.eval("(async()=>await window.api.updateSettings({overlayLocked:true}))()")
  await sleep(800)
  check('锁定状态有标记', (await o.eval("document.querySelector('.capsule')?.classList.contains('locked')")) === true)
  check('锁定后胶囊不显示锁字', (await o.eval("!!document.querySelector('.capsule-lock')")) === false)
  check('不再有调节模式标记', (await o.eval("!!document.querySelector('.capsule.adjusting')")) === false)
  check('锁定状态已持久化', (await o.eval("(async()=> (await window.api.config()).data?.settings.overlay.locked)()", true)) === true)
  check('锁定后光标为默认箭头', (await o.eval("getComputedStyle(document.querySelector('.capsule')).cursor")) === 'default')

  // 有请求应出彩虹边框，结束恢复（依赖测试中继，不通就跳过）
  await o.eval("window.api.runProbe('m1')")
  if (relayUp) {
    await sleep(250)
    const early = await o.eval("document.querySelector('.capsule-metric:not(.last)')?.innerText ?? ''")
    check('首字前不显示 0 tok/s', early === '' || early !== '0 tok/s', early)
  }
  let realtimeText = ''
  if (relayUp) {
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      realtimeText = await o.eval("document.querySelector('.capsule-metric:not(.last)')?.innerText ?? ''")
      if (realtimeText) break
    }
    check('首字后显示非零估算速率', /^<1|\d+/.test(realtimeText) && realtimeText !== '0 tok/s', realtimeText)
  }
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
  check(
    '结束后 tok/s 转灰显示上一条',
    relayUp ? await o.eval("!!document.querySelector('.capsule-metric.last')") : true,
    relayUp ? '' : '跳过：测试中继不可达'
  )

  const box = await o.eval("JSON.stringify({x:window.screenX,y:window.screenY,w:window.outerWidth,h:window.outerHeight})")
  const parsed = JSON.parse(box)
  check('悬浮窗尺寸非零且位置已恢复', parsed.w > 200 && parsed.h < 80 && parsed.x > 0 && parsed.y > 0, box)
  await o.shot('overlay.png')
  o.close()

  const cfgFile = JSON.parse(readFileSync(join(DATA, 'config.json'), 'utf8'))
  check('悬浮窗位置已持久化', cfgFile.settings.overlay.x > 0, `${cfgFile.settings.overlay.x},${cfgFile.settings.overlay.y}`)
  check('胶囊盯住的模型已持久化', cfgFile.settings.overlay.modelId === 'm1', String(cfgFile.settings.overlay.modelId))
} catch (err) {
  check('整体执行', false, `${err.message}\n${err.stack ?? ''}`)
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
