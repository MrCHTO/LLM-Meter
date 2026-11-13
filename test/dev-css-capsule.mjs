import { readFileSync, writeFileSync } from 'node:fs'

const file = 'src/renderer/styles.css'
let css = readFileSync(file, 'utf8')

const start = css.indexOf('/* ---------- 悬浮窗胶囊 ---------- */')
const end = css.indexOf('/* ---------- 按模型表 ---------- */')
if (start < 0 || end < 0) throw new Error('找不到替换区间')

const block = `/* ---------- 悬浮窗胶囊 ---------- */

body.overlay-body {
  background: transparent;
  overflow: hidden;
}

.capsule {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin: 6px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  cursor: grab;
  user-select: none;
  /* 默认黑色外观 */
  background: rgb(18 22 27 / 96%);
  border: 1px solid #333d49;
  color: #e8eef6;
}

.capsule.theme-light {
  background: rgb(255 255 255 / 97%);
  border-color: #dbe1e9;
  color: var(--text);
}

.capsule:active {
  cursor: grabbing;
}

.capsule.locked:active {
  cursor: default;
}

/* 有请求进行中：边框彩虹流动 */
.capsule.inflight::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 999px;
  z-index: -1;
  background: linear-gradient(90deg, #ff5f6d, #ffc371, #47e891, #4da3ff, #b57bff, #ff5f6d);
  background-size: 300% 100%;
  animation: rainbow 3s linear infinite;
}

@keyframes rainbow {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 300% 0;
  }
}

.capsule-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--dim);
}

.capsule-dot.on {
  background: #34d399;
}

.capsule-dot.off {
  background: #f26d6d;
}

.capsule-name {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-source,
.capsule-sep {
  color: #93a1b1;
}

.theme-light .capsule-source,
.theme-light .capsule-sep {
  color: var(--muted);
}

.capsule-cost {
  font-weight: 600;
}

.capsule-empty {
  color: #93a1b1;
}

.theme-light .capsule-empty {
  color: var(--muted);
}

.capsule-hint {
  color: #93a1b1;
}

`

css = css.slice(0, start) + block + css.slice(end)
writeFileSync(file, css)
console.log('ok', css.includes('.capsule.inflight'), css.includes('.theme-light'))
