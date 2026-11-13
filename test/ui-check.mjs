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
    '曲线标题为增量速率与请求量',
    (await s.eval("[...document.querySelectorAll('.chart-title')].map((n) => n.innerText).join(',')")) === '增量速率 tok/s,请求量'
  )
  check('两张曲线图都没有图例和峰值', (await s.eval("document.querySelectorAll('.multi-legend, .chart-foot').length")) === 0)
  const chartSizes = await s.eval("JSON.stringify([...document.querySelectorAll('.chart-card')].map((c) => ({ h: c.offsetHeight, body: c.querySelector('.chart-body')?.offsetHeight ?? 0, gap: c.getBoundingClientRect().bottom - (c.querySelector('.chart-body')?.getBoundingClientRect().bottom ?? 0) })))")
  const sizes = JSON.parse(chartSizes)
  check('两张曲线同高同版式', sizes.length === 2 && sizes[0].h === sizes[1].h && sizes[0].body === sizes[1].body && sizes[0].body >= 100, chartSizes)
  check('曲线贴近卡片底边', sizes.every((s) => s.gap <= 8), chartSizes)
  check(
    '增量曲线是折线加面积且颜色不同',
    (await s.eval("document.querySelectorAll('.multi-svg .multi-line').length")) >= 2 &&
      (await s.eval("document.querySelectorAll('.multi-svg .multi-area').length")) >= 2 &&
      (await s.eval("[...document.querySelectorAll('.multi-line')].map((l) => l.getAttribute('stroke')).filter((c, i, a) => a.indexOf(c) === i).length")) >= 2
  )
  check(
    '模型名底纹与曲线同色且为斜纹',
    (await s.eval("document.querySelector('.multi-line')?.getAttribute('stroke') ?? ''")).includes(
      await s.eval("document.querySelector('td.c-model .model-name')?.style.getPropertyValue('--mc') ?? 'x'")
    ) &&
      /repeating-linear-gradient/.test(await s.eval("getComputedStyle(document.querySelector('td.c-model .model-name')).backgroundImage"))
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
  check('曲线标题右侧不再有当前值', (await s.eval("document.querySelectorAll('.chart-now').length")) === 0)
  check('模型行内没有测速中胶囊', (await s.eval("document.querySelectorAll('td.c-model .pill').length")) === 0)
  check('表头是十一列', (await s.eval("document.querySelectorAll('thead th').length")) === 11)
  const headText = await s.eval("[...document.querySelectorAll('thead th')].map((n) => n.innerText).join('|')")
  check(
    'TTFT 拆为三个分位列',
    headText.split('|').filter((x) => x.startsWith('TTFT')).join(',') === 'TTFT P50,TTFT P95,TTFT P99'
  )
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
  check('行尾是专用拖拽列', (await s.eval("document.querySelector('thead th:last-child')?.className")) === 'c-drag')
  check('整行不再 draggable', (await s.eval("document.querySelector('tbody tr.clickable')?.getAttribute('draggable')")) === null)
  // 默认自动列宽；拖动后才固定并记住
  check(
    '默认列宽自动',
    (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'auto' &&
      (await s.eval("document.querySelectorAll('thead').length")) > 0 &&
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
  check(
    '双击恢复单列自动',
    ['', 'none', 'width: auto;'].includes(await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")) &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'fixed',
    await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
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
    '开启后变为关闭且探活点可悬停',
    (await s.eval("[...document.querySelectorAll('tbody button')].some((b) => b.innerText === '关闭')")) &&
      (await s.eval("[...document.querySelectorAll('.probe-dot')].some((d) => d.title && d.title !== '自动探针未开启')"))
  )
  check(
    '探活点在最前面',
    ((await s.eval("document.querySelector('tbody tr .row-name')?.firstElementChild?.className ?? ''")) || '').startsWith('probe-dot')
  )
  check('模型表别名与模型分两行', (await s.eval("document.querySelectorAll('tbody tr td .cell-model b').length")) > 0 &&
    (await s.eval("document.querySelectorAll('tbody tr td .cell-model small').length")) > 0)
  check(
    '模型名一行是灰色小字',
    (await s.eval("document.querySelector('tbody .cell-model small')?.className")) === 'mono' &&
      (await s.eval("getComputedStyle(document.querySelector('tbody .cell-model small')).color")) === 'rgb(140, 150, 163)'
  )
  const modelHeads = await s.eval("[...document.querySelectorAll('.tbl-models thead th')].map((th) => th.innerText).join('|')")
  check('模型表列序正确', modelHeads.startsWith('别名/模型|供应商|输入价格|输出价格|缓存读取|缓存写入|悬浮窗|自动探针'))
  check('模型表没有状态列', !modelHeads.includes('状态'))
  check('模型表每列都有调宽手柄', (await s.eval("document.querySelectorAll('.tbl-models thead .col-resize').length")) === 10)
  check('供应商表每列都有调宽手柄', (await s.eval("document.querySelectorAll('.card:first-child thead .col-resize').length")) === 6)
  // 右键菜单：关闭该行后整行变灰，再开启恢复
  const rowsBeforeMenu = await s.eval("document.querySelectorAll('.tbl-models tbody tr').length")
  await s.eval("(() => { const tr = document.querySelector('.tbl-models tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(300)
  const menuItems = await s.eval("[...document.querySelectorAll('.ctxmenu button')].map((b) => b.innerText).join(',')")
  check('模型右键菜单只有开启/编辑/删除', /^(开启|关闭),编辑,删除$/.test(menuItems), `${rowsBeforeMenu} 行, ctx=${await s.eval("document.querySelectorAll('.ctxmenu').length")}, ${menuItems}`)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '关闭' || b.innerText === '开启')?.click()")
  await sleep(900)
  check('关闭后整行变灰', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === true)
  await s.eval("(() => { const tr = document.querySelector('.tbl-models tbody tr'); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); return true })()")
  await sleep(200)
  await s.eval("[...document.querySelectorAll('.ctxmenu button')].find((b) => b.innerText === '开启')?.click()")
  await sleep(900)
  check('重新开启后恢复', (await s.eval("document.querySelector('.tbl-models tbody tr')?.classList.contains('row-off')")) === false)
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
  check('文案已改为 OpenAI', !(await s.eval('document.body.innerText')).includes('OpenAI 兼容'))
  check(
    '悬浮窗与状态是无框文字按钮',
    (await s.eval("document.querySelectorAll('.pick').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.state').length")) > 0 &&
      (await s.eval("document.querySelectorAll('.pick.btn, .state .pill').length")) === 0
  )
  const aligns = await s.eval(
    "[...document.querySelectorAll('.tbl-models thead th')].filter((th) => ['悬浮窗', '自动探针'].includes(th.innerText)).map((th) => getComputedStyle(th).textAlign).join(',')"
  )
  check('悬浮窗与自动探针列居中', aligns === 'center,center', aligns)

  // 状态一致：点另一行「选中」，胶囊立刻跟上；随后切回 m1 保持后续断言的环境
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
  check('接入页有监听端口输入', (await s.eval("document.querySelector('.kv input[type=number]') ? 1 : 0")) === 1)
  check('默认至少一个 token 且掩码显示', (await s.eval("document.querySelectorAll('.copy-text.mono').length")) >= 2)
  // 空备注被拒
  await s.eval("[...document.querySelectorAll('button')].find((b) => b.innerText === '生成 Token')?.click()")
  await sleep(400)
  check('空备注不能生成', /备注必须填写/.test(await s.eval("[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')")))
  // 带备注生成
  await s.eval(`(() => {
    const input = [...document.querySelectorAll('input[type="text"]')].find((i) => i.placeholder.includes('备注'))
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '测试备注')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await s.eval("[...document.querySelectorAll('button')].find((b) => b.innerText === '生成 Token')?.click()")
  await sleep(800)
  check(
    '备注 token 生成成功',
    /测试备注/.test(await s.eval("document.querySelector('.card:nth-child(2) tbody')?.innerText ?? ''")) &&
      (await s.eval("(async () => (await window.api.config()).data.settings.tokens.some((t) => t.remark === '测试备注'))()", true))
  )
  check('token 是 sk- 加十六进制', (await s.eval("(async () => (await window.api.config()).data.settings.tokens.every((t) => /^sk-[0-9a-f]{32}$/.test(t.token)))()", true)) === true)
  // 局域网开关：默认关，开后有局域网地址和双层状态
  check('局域网默认关闭', (await s.eval("document.body.innerText")).includes('允许局域网访问'))
  await s.eval("[...document.querySelectorAll('label')].find((l) => l.innerText.includes('允许局域网访问'))?.click()")
  for (let i = 0; i < 20; i++) {
    if (await s.eval("!!document.querySelector('.status-stack.dual')")) break
    await sleep(300)
  }
  const dualLines = await s.eval("[...document.querySelectorAll('.status-stack.dual .mono')].map((n) => n.innerText)")
  check(
    '开启局域网后状态双层且出现局域网地址',
    dualLines.length === 2 && (await s.eval("document.body.innerText.includes('局域网地址')")),
    dualLines.join(' / ')
  )
  await s.eval("[...document.querySelectorAll('label')].find((l) => l.innerText.includes('允许局域网访问'))?.click()")
  for (let i = 0; i < 20; i++) {
    if (!(await s.eval("!!document.querySelector('.status-stack.dual')"))) break
    await sleep(300)
  }

  await s.eval("document.querySelector('.tab:nth-child(2)')?.click()")
  await sleep(1500)
  check('分析页有范围与指标控件', (await s.eval("document.querySelectorAll('.card select').length")) === 3)
  check(
    '明细只有模型列左对齐',
    (await s.eval("[...document.querySelectorAll('.tbl-detail thead th')].map((th) => getComputedStyle(th).textAlign).join(',')"))
      .split(',')
      .slice(1)
      .every((x) => x === 'center')
  )
  check('分析页没有来源下拉', !(await s.eval('document.body.innerText')).includes('来源'))
  check(
    '指标只剩五项',
    (await s.eval("[...document.querySelectorAll('.card select')][1] ? [...[...document.querySelectorAll('.card select')][1].options].map((o) => o.text).join(',') : ''")) ===
      '请求数,总 token,输入 token,输出 token,成本'
  )
  check('分析页有明细表', (await s.eval("document.querySelectorAll('tbody tr').length")) >= 1)
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
  check('按 Token 备注分组生效', (await s.eval("document.querySelector('.tbl-detail thead th')?.innerText ?? ''")) === 'Token 备注')
  await s.eval(`(() => {
    const sel = [...document.querySelectorAll('.card select')][2]
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'model')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1200)
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
    if (await s.eval("!!document.querySelector('.settings-nav')")) break
    await sleep(300)
  }
  await sleep(300)
  check('设置页有三个分组', (await s.eval("document.querySelectorAll('.settings-nav button').length")) === 3)
  check('设置页不再有接入组', (await s.eval("document.querySelector('.settings-nav')?.innerText || ''")).includes('接入') === false)
  check('右上角状态只有本机一行', (await s.eval("document.querySelectorAll('.status-stack .mono').length")) === 1)

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
    '开机自启开关存在',
    await s.eval("[...document.querySelectorAll('input[type=checkbox]')].some((c) => c.closest('label')?.innerText.includes('开机自启'))")
  )
  check(
    '自动探针间隔是数字输入',
    (await s.eval("[...document.querySelectorAll('.field')].filter((f) => f.innerText.includes('自动探针间隔')).length")) === 1
  )
  check('设置页不再显示当前汇率', !(await s.eval("document.body.innerText")).includes('当前汇率'))
  check('设置页不再显示上次校准', !(await s.eval("document.body.innerText")).includes('上次校准'))
  check('设置页没有立即校准按钮', !(await s.eval("document.body.innerText")).includes('立即校准'))
  check(
    '保留自动校准开关',
    await s.eval("[...document.querySelectorAll('input[type=checkbox]')].some((c) => c.closest('label')?.innerText.includes('自动校准'))")
  )

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

  // 锁定
  await o.eval("(async()=>await window.api.updateSettings({overlayLocked:true}))()")
  await sleep(800)
  check('锁定状态有标记', (await o.eval("document.querySelector('.capsule')?.classList.contains('locked')")) === true)
  check('锁定后胶囊不显示锁字', (await o.eval("!!document.querySelector('.capsule-lock')")) === false)
  check('不再有调节模式标记', (await o.eval("!!document.querySelector('.capsule.adjusting')")) === false)

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
