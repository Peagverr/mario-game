import { useEffect, useRef, useState } from 'react'
import { sfx } from '../game/sfx'
import { control, type Hint } from '../shared/controlState'
import { speak } from './speech'

const ARROWS: Record<NonNullable<Hint['arrow']>, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  closer: '↘',
  farther: '↖',
}

/** Подсказки «режима ошибки»: карточка внизу экрана + звук + голос. */
export function Hints() {
  const [hints, setHints] = useState<Hint[]>([])
  const shown = useRef(new Set<string>())

  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const key = control.hints.map((h) => h.code + h.text).join('|')
      if (key === last) return
      last = key
      const current = [...control.hints]
      // Новая подсказка — короткий звук и озвучка (не чаще, чем раз в несколько секунд).
      const fresh = current.find((h) => !shown.current.has(h.code))
      if (fresh) {
        sfx.hint()
        speak(fresh.text)
      }
      shown.current = new Set(current.map((h) => h.code))
      setHints(current)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!hints.length) return null
  return (
    <div className="hints" role="status" aria-live="polite">
      {hints.map((h) => (
        <div key={h.code} className={`hint hint--${h.hand ?? 'none'}`}>
          {h.arrow && <span className="hint__arrow">{ARROWS[h.arrow]}</span>}
          <span className="hint__text">{h.text}</span>
        </div>
      ))}
    </div>
  )
}
