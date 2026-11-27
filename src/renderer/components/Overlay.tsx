import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useApp, useConfig } from '../state/AppState'

import { LIMITS, clampInt } from '../../shared/limits'
import { OVERLAY_EFFECT_PAD } from '../../shared/overlay'
import { OVERLAY_EFFECTS } from '../../shared/types'
import type { OverlayEffect } from '../../shared/types'
import { Switch } from './Switch'

/** 单个效果预览：常驻演示，胶囊外观与速度跟随当前设置 */
function EffectOption(props: {
  id: OverlayEffect
  label: string
  active: boolean
  theme: 'dark' | 'light'
  speed: number
  onPick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`effect-option${props.active ? ' active' : ''}`}
      aria-pressed={props.active}
      onClick={props.onPick}
    >
      <span className="effect-stage">
        <span
          className={`capsule mini theme-${props.theme} effect-${props.id} lit running`}
          style={
            {
              '--pad': `${OVERLAY_EFFECT_PAD[props.id]}px`,
              '--spd': String(props.speed / 100)
            } as CSSProperties
          }
        >
          <span className="capsule-dot on" />
          <span className="capsule-metric mono">47 tok/s</span>
        </span>
      </span>
      <span className="effect-label">{props.label}</span>
    </button>
  )
}

export function OverlayView(): JSX.Element {
  const config = useConfig()
  const { notify, reload: onChanged } = useApp()
  const [opacity, setOpacity] = useState<string>(String(config.settings.overlayOpacity))
  const [speed, setSpeed] = useState<number>(config.settings.overlay.speed)
  const [posX, setPosX] = useState(config.settings.overlay.x === null ? '' : String(config.settings.overlay.x))
  const [posY, setPosY] = useState(config.settings.overlay.y === null ? '' : String(config.settings.overlay.y))

  // 速度从别处变化时同步回显
  useEffect(() => setSpeed(config.settings.overlay.speed), [config.settings.overlay.speed])

  // 拖动会改坐标，回到本页时同步显示最新值
  useEffect(() => {
    setPosX(config.settings.overlay.x === null ? '' : String(config.settings.overlay.x))
    setPosY(config.settings.overlay.y === null ? '' : String(config.settings.overlay.y))
  }, [config.settings.overlay.x, config.settings.overlay.y])

  // 坐标随悬浮窗实时位置走；正在编辑的输入框不被轮询覆盖
  useEffect(() => {
    let stopped = false
    const tick = async (): Promise<void> => {
      const res = await window.api.overlayState()
      if (stopped || !res.ok || !res.data) return
      const active = document.activeElement as HTMLInputElement | null
      if (active?.dataset.field !== 'posX') setPosX(String(res.data.bounds.x))
      if (active?.dataset.field !== 'posY') setPosY(String(res.data.bounds.y))
      if (active?.dataset.field !== 'opacity') setOpacity(String(res.data.opacity))
    }
    void tick()
    const timer = setInterval(() => void tick(), 700)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  // 不透明度从别处变化时同步回显
  useEffect(() => {
    const active = document.activeElement as HTMLInputElement | null
    if (active?.dataset.field !== 'opacity') setOpacity(String(config.settings.overlayOpacity))
  }, [config.settings.overlayOpacity])

  const patch = async (values: Parameters<typeof window.api.updateSettings>[0]): Promise<boolean> => {
    try {
      const res = await window.api.updateSettings(values)
      if (!res.ok) {
        notify(res.error ?? '保存失败')
        return false
      }
      await onChanged()
      return true
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败')
      return false
    }
  }

  const applyOpacity = async (): Promise<void> => {
    const value = clampInt('overlayOpacity', Number(opacity) || LIMITS.overlayOpacity.fallback)
    setOpacity(String(value))
    await patch({ overlayOpacity: value })
  }

  const overlayModel = config.models.find((m) => m.id === config.settings.overlay.modelId)
  const theme = config.settings.overlay.theme

  return (
    <div className="section settings-cards">
      <div className="card">
        <h2>悬浮窗</h2>
        <div className="setting-row">
          <span>当前模型</span>
          <span className="muted">
            {config.settings.overlay.global ? '全局（全部模型）' : overlayModel ? overlayModel.alias : '未选择'}
          </span>
        </div>
        <div className="setting-row">
          <span>显示状态</span>
          <button
            className="btn sm"
            onClick={async () => {
              const next = !config.settings.overlay.visible
              await patch({ overlayVisible: next })
              notify(next ? '已显示' : '已隐藏', 'ok')
            }}
          >
            {config.settings.overlay.visible ? '隐藏悬浮窗' : '显示悬浮窗'}
          </button>
        </div>
        <div className="setting-row">
          <span>锁定位置</span>
          <Switch
            checked={config.settings.overlay.locked}
            onChange={(locked) => void patch({ overlayLocked: locked })}
          />
        </div>
        <div className="setting-row">
          <span>吸附屏幕中线</span>
          <Switch
            checked={config.settings.overlay.snapCenter}
            onChange={(snapCenter) => void patch({ overlaySnapCenter: snapCenter })}
          />
        </div>
      </div>

      <div className="card">
        <h2>外观</h2>
        <div className="setting-row">
          <span>胶囊颜色</span>
          <div className="row nowrap">
            <button
              className={`btn sm${theme === 'dark' ? ' on' : ''}`}
              aria-pressed={theme === 'dark'}
              onClick={() => void patch({ overlayTheme: 'dark' })}
            >
              黑色
            </button>
            <button
              className={`btn sm${theme === 'light' ? ' on' : ''}`}
              aria-pressed={theme === 'light'}
              onClick={() => void patch({ overlayTheme: 'light' })}
            >
              白色
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span>显示供应商名称</span>
          <Switch
            checked={config.settings.overlay.showProvider}
            onChange={(showProvider) => void patch({ overlayShowProvider: showProvider })}
          />
        </div>
        <div className="setting-row">
          <span>显示模型名称</span>
          <Switch
            checked={config.settings.overlay.showModel}
            onChange={(showModel) => void patch({ overlayShowModel: showModel })}
          />
        </div>
        <div className="setting-row">
          <span>显示费用</span>
          <Switch
            checked={config.settings.overlay.showCost}
            onChange={(showCost) => void patch({ overlayShowCost: showCost })}
          />
        </div>
      </div>

      <div className="card">
        <h2>进行中的效果</h2>
        <p className="muted effect-hint">请求在跑时胶囊边框的表现，点一项即时生效。</p>
        <div className="effect-grid">
          {OVERLAY_EFFECTS.map((effect) => (
            <EffectOption
              key={effect.id}
              id={effect.id}
              label={effect.label}
              active={config.settings.overlay.effect === effect.id}
              theme={theme}
              speed={speed}
              onPick={() => void patch({ overlayEffect: effect.id })}
            />
          ))}
        </div>
        <div className="setting-row">
          <span>
            效果速度（{LIMITS.overlaySpeed.min}–{LIMITS.overlaySpeed.max}%）
          </span>
          <div className="row nowrap">
            <input
              className="speed-range"
              type="range"
              min={LIMITS.overlaySpeed.min}
              max={LIMITS.overlaySpeed.max}
              step={10}
              value={speed}
              aria-label="效果速度"
              onChange={(e) => setSpeed(Number(e.target.value))}
              onPointerUp={() => void patch({ overlaySpeed: speed })}
              onKeyUp={(e) => {
                if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
                  void patch({ overlaySpeed: speed })
                }
              }}
            />
            <span className="mono speed-value">×{(speed / 100).toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>位置与透明度</h2>
        <div className="setting-row">
          <span>位置 X / Y（像素）</span>
          <div className="row nowrap">
            <input
              className="mono w-sm"
              data-field="posX"
              type="number"
              value={posX}
              onChange={(e) => setPosX(e.target.value)}
            />
            <input
              className="mono w-sm"
              data-field="posY"
              type="number"
              value={posY}
              onChange={(e) => setPosY(e.target.value)}
            />
            <button
              className="btn sm"
              onClick={() => {
                const x = Math.round(Number(posX))
                const y = Math.round(Number(posY))
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                  notify('X / Y 需要是数字', 'bad')
                  return
                }
                void patch({ overlayX: x, overlayY: y })
              }}
            >
              应用
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span>
            不透明度（{LIMITS.overlayOpacity.min}–{LIMITS.overlayOpacity.max}）
          </span>
          <div className="row nowrap">
            <input
              className="mono w-sm"
              data-field="opacity"
              type="number"
              min={LIMITS.overlayOpacity.min}
              max={LIMITS.overlayOpacity.max}
              value={opacity}
              onChange={(e) => setOpacity(e.target.value)}
              onKeyUp={(e) => {
                if (e.key === 'Enter') void applyOpacity()
              }}
            />
            <button className="btn sm" onClick={() => void applyOpacity()}>
              应用
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
