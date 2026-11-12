import { readFileSync, writeFileSync } from 'node:fs'

const file = 'src/renderer/styles.css'
let css = readFileSync(file, 'utf8')

const start = css.indexOf('/* ---------- 悬浮窗 ---------- */')
const end = css.indexOf('/* ---------- 按模型表 ---------- */')
if (start < 0 || end < 0) throw new Error('找不到替换区间')

const block = `/* ---------- 悬浮窗胶囊 ---------- */

body.overlay-body {
  background: transparent;
  overflow: hidden;
}

.capsule {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin: 4px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgb(255 255 255 / 97%);
  border: 1px solid #dbe1e9;
  box-shadow: 0 6px 18px rgb(15 23 42 / 16%);
  font-size: 12px;
  white-space: nowrap;
  cursor: grab;
  user-select: none;
}

.capsule:active {
  cursor: grabbing;
}

.capsule-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--dim);
}

.capsule-dot.on {
  background: var(--ok);
}

.capsule-dot.off {
  background: var(--bad);
}

.capsule-name {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-source {
  color: var(--muted);
}

.capsule-sep {
  color: var(--dim);
}

.capsule-cost {
  font-weight: 600;
}

.capsule-empty {
  color: var(--muted);
}

`

css = css.slice(0, start) + block + css.slice(end)
writeFileSync(file, css)
console.log('ok', !css.includes('.orow'), css.includes('.capsule'))
