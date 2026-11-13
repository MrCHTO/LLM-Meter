const MIN = 10
const MAX = 100

const track = document.getElementById('track') as HTMLDivElement
const knob = document.getElementById('knob') as HTMLElement
const valueEl = document.getElementById('value') as HTMLElement

let value = 100

function paint(v: number): void {
  value = Math.min(MAX, Math.max(MIN, Math.round(v)))
  const ratio = (value - MIN) / (MAX - MIN)
  knob.style.left = `${ratio * 100}%`
  valueEl.textContent = `${value}%`
}

async function push(v: number): Promise<void> {
  paint(v)
  await window.api.updateSettings({ overlayOpacity: value })
}

function fromClientX(x: number): void {
  const rect = track.getBoundingClientRect()
  const ratio = (x - rect.left) / Math.max(1, rect.width)
  void push(MIN + ratio * (MAX - MIN))
}

track.addEventListener('pointerdown', (event) => {
  track.setPointerCapture(event.pointerId)
  fromClientX(event.clientX)
})
track.addEventListener('pointermove', (event) => {
  if (event.buttons & 1) fromClientX(event.clientX)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.close()
})

void window.api.config().then((res) => {
  paint(res.ok && res.data ? res.data.settings.overlayOpacity : 92)
})
