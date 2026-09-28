import { useEffect, useRef } from 'react'
import { control } from '../shared/controlState'

/**
 * Экранный индикатор джойстика: кружок справа внизу, точка показывает, куда и насколько сдвинута правая ладонь.
 * Внутренний круг — «мёртвая зона»: пока точка внутри, герой стоит.
 */
export function JoystickIndicator() {
  const root = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const j = control.joystick
      // В режиме разработки с клавиатуры показываем направление ходьбы.
      const x = j.active ? j.x : control.move.x
      const y = j.active ? j.y : control.move.y
      const active = j.active || control.move.x !== 0 || control.move.y !== 0
      const moving = control.move.x !== 0 || control.move.y !== 0
      if (knob.current) knob.current.style.transform = `translate(${x * 42}px, ${-y * 42}px)`
      root.current?.classList.toggle('is-idle', !active)
      root.current?.classList.toggle('is-moving', moving)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={root} className="joystick is-idle" aria-hidden>
      <div className="joystick__ring">
        <div className="joystick__dead" style={{ width: `${control.joystick.deadzone * 100}%`, height: `${control.joystick.deadzone * 100}%` }} />
        <div ref={knob} className="joystick__knob" />
      </div>
      <span className="joystick__label">правая ладонь</span>
    </div>
  )
}
