/**
 * SSE 旁路解析器：调用方把每个网络块原样转发给客户端，同时喂一份到这里。
 * 必须跨块累积——一个事件帧经常被 TCP 切在任意位置，绝不能按块解析。
 */
const MAX_BUFFER = 8 * 1024 * 1024
/** 帧分隔：兼容 \n\n 与 \r\n\r\n 两种写法 */
const SEPARATOR = /\r?\n\r?\n/

export class SseTap {
  private decoder = new TextDecoder('utf-8')
  private buffer = ''
  private overflow = false

  /** 返回本次新凑齐的完整帧（已去掉分隔符）。 */
  feed(chunk: Buffer): string[] {
    if (this.overflow) return []
    this.buffer += this.decoder.decode(chunk, { stream: true })
    if (this.buffer.length > MAX_BUFFER) {
      this.overflow = true
      this.buffer = ''
      return []
    }

    const frames: string[] = []
    for (;;) {
      const match = SEPARATOR.exec(this.buffer)
      if (!match || match.index === undefined) break
      frames.push(this.buffer.slice(0, match.index))
      this.buffer = this.buffer.slice(match.index + match[0].length)
    }
    return frames
  }

  get buffered(): number {
    return this.buffer.length
  }

  reset(): void {
    this.decoder = new TextDecoder('utf-8')
    this.buffer = ''
    this.overflow = false
  }
}

/** 取出帧里的 data 载荷；`[DONE]` 也照原样返回。 */
export function dataOf(frame: string): string[] {
  const out: string[] = []
  for (const line of frame.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) continue
    out.push(trimmed.slice(5).trimStart())
  }
  return out
}

export function parseJson(payload: string): Record<string, unknown> | null {
  if (!payload || payload === '[DONE]') return null
  try {
    const parsed: unknown = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}
