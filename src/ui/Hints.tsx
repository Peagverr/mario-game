import { useEffect, useRef, useState } from 'react'
import { sfx } from '../game/sfx'
import { voiceNow } from '../game/voice'
import { control, type Hint } from '../shared/controlState'
import { useGame } from '../shared/gameStore'

const ARROWS: Record<NonNullable<Hint['arrow']>, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  closer: '↘',
  farther: '↖',
}

/**
 * Подсказки «режима ошибки»: карточка внизу экрана и короткий сигнал. Одна за раз — какую, решает HintFilter.
 * Над ними — субтитры голоса «Окна» (кроме подсказок: их текст и так на карточке, и кроме обучения: там своя карточка).
 */
export function Hints() {
  const [hints, setHints] = useState<Hint[]>([])
  const [subtitle, setSubtitle] = useState('')
  const shown = useRef(new Set<string>())

  useEffect(() => {
    let raf = 0
    let last = ''
    let lastSub = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // Сюжетные реплики (story.*) — субтитрами всегда, и в обучении: это рассказ, а не инструкция с карточки.
      const story = voiceNow.id.startsWith('story.')
      const sub = !story && (voiceNow.id.startsWith('hint.') || useGame.getState().phase === 'tutorial') ? '' : voiceNow.text
      if (sub !== lastSub) {
        lastSub = sub
        setSubtitle(sub)
      }
      const key = control.hints.map((h) => h.code + h.text).join('|')
      if (key === last) return
      last = key
      const current = [...control.hints]
      // Новая подсказка — короткий сигнал.
      if (current.some((h) => !shown.current.has(h.code))) sfx.hint()
      shown.current = new Set(current.map((h) => h.code))
      setHints(current)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!hints.length && !subtitle) return null
  return (
    <div className="hints" role="status" aria-live="polite">
      {subtitle && (
        <div key={subtitle} className="subtitle">
          <span className="subtitle__who">Окно</span>
          {subtitle}
        </div>
      )}
      {hints.map((h) => (
        <div key={h.code} className={`hint hint--${h.hand ?? 'none'}`}>
          {h.arrow && <span className="hint__arrow">{ARROWS[h.arrow]}</span>}
          <span className="hint__text">{h.text}</span>
        </div>
      ))}
    </div>
  )
}
