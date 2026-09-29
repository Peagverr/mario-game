import { useEffect, useState } from 'react'
import { control } from '../shared/controlState'
import { sfx } from '../game/sfx'
import { useGame, runSeconds } from '../shared/gameStore'
import { DwellButton } from './Dwell'

/** Отсчёт 3-2-1 перед стартом. */
export function Countdown() {
  const [n, setN] = useState(3)
  useEffect(() => {
    if (n < 0) {
      useGame.getState().startRun()
      return
    }
    sfx.count(n === 0)
    const id = setTimeout(() => setN(n - 1), n === 0 ? 500 : 800)
    return () => clearTimeout(id)
  }, [n])
  return (
    <div className="countdown" key={n}>
      {n > 0 ? n : 'Вперёд!'}
    </div>
  )
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** Счёт во время игры: звёзды, время, подсказка по жестам. */
export function HUD() {
  const sceneId = useGame((s) => s.sceneId)
  const stars = useGame((s) => s.starsCollected)
  const total = useGame((s) => s.starsTotal)
  const [time, setTime] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTime(runSeconds(useGame.getState())), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud">
      {sceneId === 'lobby' ? (
        <div className="hud__pill hud__pill--lobby">Лобби — зайди в портал, чтобы начать уровень</div>
      ) : (
        <>
          <div className="hud__pill">
            <span className="hud__star" aria-hidden>★</span>
            <b>{stars}</b>
            <span className="hud__dim">/ {total}</span>
          </div>
          <div className="hud__pill hud__pill--time">{formatTime(time)}</div>
        </>
      )}
      <div className="hud__legend">
        {control.scheme === 'pointer' ? (
          <>
            <span>палец — идти</span>
            <span>ладонь — стоп</span>
          </>
        ) : (
          <span>ладонь — идти</span>
        )}
        <span>кулак — прыжок</span>
        <span>щипок левой — повернуть и наклонить</span>
        <span>две ладони — меню</span>
      </div>
    </div>
  )
}

export function PauseMenu() {
  const [scheme, setScheme] = useState(control.scheme)
  const toggleScheme = () => {
    control.scheme = control.scheme === 'pointer' ? 'palm' : 'pointer'
    control.move.x = control.move.y = 0
    setScheme(control.scheme)
  }
  return (
    <div className="screen screen--dim">
      <div className="card">
        <h2 className="title title--small">Меню</h2>
        <p className="lead">Наведи палец на кнопку и подержи секунду.</p>
        <div className="row">
          <DwellButton onActivate={() => useGame.getState().setPhase('playing')}>Продолжить</DwellButton>
          <DwellButton variant="ghost" onActivate={() => useGame.getState().restart()}>
            Заново
          </DwellButton>
          {useGame.getState().sceneId !== 'lobby' && (
            <DwellButton variant="ghost" onActivate={() => useGame.getState().goToScene('lobby')}>
              В лобби
            </DwellButton>
          )}
          <DwellButton variant="ghost" onActivate={toggleScheme}>
            Ходьба: {scheme === 'pointer' ? 'палец' : 'ладонь'}
          </DwellButton>
        </div>
      </div>
    </div>
  )
}
