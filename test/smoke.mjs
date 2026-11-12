/** 冒烟：用临时档案起应用，等健康检查通过后关掉。 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = mkdtempSync(join(tmpdir(), 'llmmeter-smoke-'))
const child = spawn(join('node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--no-sandbox', `--user-data-dir=${profile}`], {
  stdio: ['ignore', 'pipe', 'pipe']
})
let log = ''
child.stdout.on('data', (d) => (log += d))
child.stderr.on('data', (d) => (log += d))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let up = false
for (let i = 0; i < 40; i++) {
  await sleep(500)
  try {
    const res = await fetch('http://127.0.0.1:8787/healthz')
    if (res.ok) {
      up = true
      break
    }
  } catch {
    /* 继续等 */
  }
}
console.log('booted:', up)
if (!up) console.log(log.slice(-2000))
child.kill()
await sleep(400)
rmSync(profile, { recursive: true, force: true })
process.exit(up ? 0 : 1)
