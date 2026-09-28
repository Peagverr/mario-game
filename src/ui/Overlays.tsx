import { useEffect, useState } from 'react'
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
  const stars = useGame((s) => s.starsCollected)
  const total = useGame((s) => s.starsTotal)
  const [time, setTime] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTime(runSeconds(useGame.getState())), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud">
      <div className="hud__pill">
        <span className="hud__star" aria-hidden>★</span>
        <b>{stars}</b>
        <span className="hud__dim">/ {total}</span>
      </div>
      <div className="hud__pill hud__pill--time">{formatTime(time)}</div>
      <div className="hud__legend">
        <span>ладонь — идти</span>
        <span>кулак — прыжок</span>
        <span>щипок левой — повернуть</span>
        <span>две ладони — пауза</span>
      </div>
    </div>
  )
}

export function PauseMenu() {
  return (
    <div className="screen screen--dim">
      <div className="card">
        <h2 className="title title--small">Пауза</h2>
        <p className="lead">Наведи палец на кнопку и подержи секунду.</p>
        <div className="row">
          <DwellButton onActivate={() => useGame.getState().setPhase('playing')}>Продолжить</DwellButton>
          <DwellButton variant="ghost" onActivate={() => useGame.getState().restart()}>
            Заново
          </DwellButton>
        </div>
      </div>
    </div>
  )
}
