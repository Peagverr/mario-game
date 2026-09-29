import { useEffect, useRef } from 'react'
import { runtime } from '../game/runtime'
import { control } from '../shared/controlState'
import { schemeInfo } from '../shared/schemes'

/**
 * Экранный индикатор ходьбы справа внизу: точка показывает, куда идёт герой.
 * Палец: точка на краю круга по направлению пальца, в центре — «стоп».
 * Ладонь-джойстик: точка — сдвиг ладони, внутренний круг — «мёртвая зона».
 */
export function JoystickIndicator() {
  const root = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const dead = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let lastText = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const j = control.joystick
      // В режиме разработки с клавиатуры показываем направление ходьбы.
      const x = j.active ? j.x : control.move.x
      const y = j.active ? j.y : control.move.y
      const active = j.active || control.move.x !== 0 || control.move.y !== 0
      const moving = (control.move.x !== 0 || control.move.y !== 0) && !runtime.moveLocked
      if (knob.current) knob.current.style.transform = `translate(${x * 42}px, ${-y * 42}px)`
      root.current?.classList.toggle('is-idle', !active)
      root.current?.classList.toggle('is-moving', moving)
      root.current?.classList.toggle('is-locked', runtime.moveLocked)
      if (dead.current) dead.current.style.display = control.scheme === 'pointer' ? 'none' : ''

      const text = runtime.moveLocked
        ? 'стоишь — смени жест'
        : control.scheme === 'palm'
          ? 'правая ладонь'
          : moving ? `${schemeInfo().title.toLowerCase()} — идёт` : active ? 'стоп' : 'вытяни палец'
      if (text !== lastText && label.current) {
        label.current.textContent = text
        lastText = text
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={root} className="joystick is-idle" aria-hidden>
      <div className="joystick__ring">
        <div ref={dead} className="joystick__dead" style={{ width: `${control.joystick.deadzone * 100}%`, height: `${control.joystick.deadzone * 100}%` }} />
        <div ref={knob} className="joystick__knob" />
      </div>
      <span ref={label} className="joystick__label" />
    </div>
  )
}

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
