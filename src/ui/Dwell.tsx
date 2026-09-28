import { useEffect, useRef, type ReactNode } from 'react'
import { sfx } from '../game/sfx'
import { control } from '../shared/controlState'

/**
 * Кнопки без мыши: наведи курсор-руку и держи ~1 секунду, пока кольцо не заполнится.
 * Мышью тоже можно нажать — это запасной вариант, не основной.
 */

const DWELL_MS = 1000

export function DwellButton({
  children,
  onActivate,
  variant = 'primary',
}: {
  children: ReactNode
  onActivate: () => void
  variant?: 'primary' | 'ghost'
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const cb = useRef(onActivate)
  cb.current = onActivate

  useEffect(() => {
    let raf = 0
    let progress = 0
    let last = performance.now()
    let cooldownUntil = 0
    let wasOver = false
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = now - last
      last = now
      const el = ref.current
      if (!el) return
      const c = control.cursor
      const r = el.getBoundingClientRect()
      const x = c.x * window.innerWidth
      const y = c.y * window.innerHeight
      const over = c.visible && now > cooldownUntil && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
      if (over && !wasOver) sfx.tick()
      wasOver = over
      progress = over ? progress + dt / DWELL_MS : Math.max(0, progress - dt / 300)
      el.style.setProperty('--dwell', String(Math.min(1, progress)))
      el.classList.toggle('is-hover', over)
      if (progress >= 1) {
        progress = 0
        cooldownUntil = now + 800
        sfx.confirm()
        cb.current()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <button
      ref={ref}
      className={`dwell-btn dwell-btn--${variant}`}
      onClick={() => {
        sfx.confirm()
        cb.current()
      }}
    >
      <span className="dwell-btn__ring" aria-hidden />
      <span className="dwell-btn__label">{children}</span>
    </button>
  )
}

/** Курсор-рука поверх экрана (виден в меню). */
export function HandCursor() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = ref.current
      if (!el) return
      const c = control.cursor
      el.style.opacity = c.visible ? '1' : '0'
      el.style.transform = `translate(${c.x * window.innerWidth}px, ${c.y * window.innerHeight}px)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <div ref={ref} className="hand-cursor" aria-hidden />
}
