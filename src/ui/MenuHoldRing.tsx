import { useEffect, useRef } from 'react'
import { control } from '../shared/controlState'

/** Кольцо «открываю меню», пока держишь две раскрытые ладони. */
export function MenuHoldRing() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = root.current
      if (!el) return
      const p = control.menuHold
      el.style.opacity = p > 0.05 ? '1' : '0'
      el.style.setProperty('--p', String(p))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={root} className="menu-hold" aria-hidden>
      <div className="menu-hold__ring" />
      <span>Меню…</span>
    </div>
  )
}
