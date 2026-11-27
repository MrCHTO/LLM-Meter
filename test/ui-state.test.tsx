// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider, useApp, useConfig } from '../src/renderer/state/AppState'
import { Confirm, useConfirm } from '../src/renderer/components/Confirm'

const CONFIG = {
  providers: [],
  models: [],
  settings: { theme: 'system' as const },
  dataDir: '/tmp',
  version: '1.0.0'
}

function stubApi(over: Record<string, unknown> = {}): { emit: (s: unknown) => void } {
  let onPush: ((s: unknown) => void) | null = null
  Object.assign(window, {
    api: {
      config: vi.fn(async () => ({ ok: true, data: CONFIG })),
      onPush: (fn: (s: unknown) => void) => {
        onPush = fn
        return () => undefined
      },
      onCalibrated: () => () => undefined,
      ...over
    }
  })
  return { emit: (s) => act(() => onPush?.(s)) }
}

const wrapper = ({ children }: { children: ReactNode }): JSX.Element => <AppProvider>{children}</AppProvider>

describe('应用状态', () => {
  it('加载成功后配置可用，快照随推送更新', async () => {
    const { emit } = stubApi()
    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => expect(result.current.config).not.toBeNull())
    emit({ ts: 1, proxyRunning: true, models: [], totals: {} })
    await waitFor(() => expect(result.current.snapshot).toEqual(expect.objectContaining({ proxyRunning: true })))
  })

  it('配置就绪后 useConfig 返回配置', async () => {
    stubApi()
    function Inner(): JSX.Element {
      const cfg = useConfig()
      return <span>版本 {cfg.version}</span>
    }
    function Probe(): JSX.Element {
      const { config } = useApp()
      return config ? <Inner /> : <span>加载中</span>
    }
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByText('版本 1.0.0')).toBeTruthy())
  })

  it('配置接口报错时提示里能看到原因', async () => {
    stubApi({ config: vi.fn(async () => ({ ok: false, error: '读不了配置' })) })
    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => expect(result.current.toasts.map((t) => t.text)).toContain('读不了配置'))
  })
})

describe('确认框', () => {
  it('确定返回 true，取消返回 false', async () => {
    const holder: { ask?: (m: string) => Promise<boolean> } = {}
    function Harness(): JSX.Element {
      const { ask, confirmProps } = useConfirm()
      holder.ask = ask
      return <Confirm {...confirmProps} />
    }
    render(<Harness />)

    let answer: Promise<boolean> = Promise.resolve(false)
    act(() => {
      answer = holder.ask?.('删除该模型？') ?? Promise.resolve(false)
    })
    expect(screen.getByText('删除该模型？')).toBeTruthy()
    act(() => screen.getByText('取消').click())
    await expect(answer).resolves.toBe(false)

    act(() => {
      answer = holder.ask?.('再删一次？') ?? Promise.resolve(false)
    })
    act(() => screen.getByText('确定').click())
    await expect(answer).resolves.toBe(true)
  })
})
