import { useEffect, useState } from 'react'
import { sfx } from '../game/sfx'
import { control, type CameraStatus } from '../shared/controlState'
import { useGame } from '../shared/gameStore'

/**
 * Камера перестала видеть игрока (шторка, кнопка-выключатель, другая программа): игра встаёт на паузу,
 * таймер не идёт. Камера вернулась — «Вижу тебя снова», отсчёт 3-2-1 и игра продолжается сама.
 * Если игрок сам открывал меню — после возвращения камеры снова меню, без отсчёта.
 */

/** Камера не работает дольше этого (мс) — пауза. */
const CAMERA_PAUSE_MS = 1500
/** Камера работает столько (мс) — начинаем отсчёт (на случай, если шторку только приоткрыли). */
const BACK_STABLE_MS = 400
const COUNT_FROM = 3
const COUNT_STEP_MS = 800

const TEXT: Record<Exclude<CameraStatus, 'ok'>, string> = {
  black: 'Камера показывает чёрный кадр. Открой шторку камеры или закрой программу, которая её заняла.',
  frozen: 'Камера перестала присылать картинку. Проверь, что она включена и её не заняла другая программа.',
  ended: 'Камера отключилась. Включи её (кнопкой на ноутбуке или в настройках) — игра подключится сама.',
}

/** Следит за камерой и ставит игру на паузу, если камера пропала. */
export function useCameraPause() {
  useEffect(() => {
    let raf = 0
    let badSince = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const bad = control.tracking.ready && control.tracking.camera !== 'ok'
      if (!bad) {
        badSince = 0
        return
      }
      badSince ||= now
      const g = useGame.getState()
      if (now - badSince > CAMERA_PAUSE_MS && g.phase === 'playing') g.pause('camera')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}

/** Карточка на паузе, пока камеры нет. Возвращает null, когда показывать нечего. */
export function CameraLost() {
  const [cam, setCam] = useState<CameraStatus>(control.tracking.camera)
  const [count, setCount] = useState(0)
  const reason = useGame((s) => s.pauseReason)

  useEffect(() => {
    let raf = 0
    let okSince = 0
    let counting = false
    let countStart = 0
    let last: CameraStatus | '' = ''
    let lastCount = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const c = control.tracking.camera
      if (c !== last) {
        last = c
        setCam(c)
      }
      if (c !== 'ok') {
        okSince = 0
        counting = false
        if (lastCount !== 0) setCount((lastCount = 0))
        return
      }
      okSince ||= now
      const g = useGame.getState()
      // Меню открыл сам игрок — камера вернулась, меню на месте, без отсчёта.
      if (g.pauseReason !== 'camera' || now - okSince < BACK_STABLE_MS) return
      if (!counting) {
        counting = true
        countStart = now
      }
      const n = COUNT_FROM - Math.floor((now - countStart) / COUNT_STEP_MS)
      if (n !== lastCount) {
        lastCount = n
        setCount(n)
        if (n > 0) sfx.count(false)
      }
      if (n <= 0) {
        sfx.count(true)
        cancelAnimationFrame(raf)
        g.setPhase('playing')
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (cam === 'ok' && reason !== 'camera') return null
  return (
    <div className="screen screen--dim">
      <div className="card">
        {cam === 'ok' ? (
          <>
            <h2 className="title title--small">Вижу тебя снова</h2>
            <p className="lead">{count > 0 ? `Продолжаем через ${count}…` : 'Сейчас продолжим…'}</p>
          </>
        ) : (
          <>
            <h2 className="title title--small">Камера не видит</h2>
            <p className="lead">{TEXT[cam]}</p>
            <p className="fine">Игра на паузе, таймер стоит. Как только камера заработает, продолжим с того же места.</p>
          </>
        )}
      </div>
    </div>
  )
}
