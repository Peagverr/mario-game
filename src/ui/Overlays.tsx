import { useEffect, useRef, useState } from 'react'
import { sfx } from '../game/sfx'
import { useLang, useT } from '../i18n'
import {
  beginJoystickCalibration,
  calibrateJoystick,
  endJoystickCalibration,
  grabSpeed,
  palmRingScale,
  resizePalmRing,
  scaleGrabSpeed,
} from '../input/tracker'
import { control } from '../shared/controlState'
import { useGame, runSeconds } from '../shared/gameStore'
import { DwellButton } from './Dwell'

/** Отсчёт 3-2-1 перед стартом. */
export function Countdown() {
  const [n, setN] = useState(3)
  const go = useT().hud.go
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
      {n > 0 ? n : go}
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
  const secrets = useGame((s) => s.secretsFound)
  const secretsTotal = useGame((s) => s.secretsTotal)
  const [time, setTime] = useState(0)
  const [grabbing, setGrabbing] = useState(false)
  const s = useT().hud

  useEffect(() => {
    const id = setInterval(() => {
      setTime(runSeconds(useGame.getState()))
      setGrabbing(control.view.grabbing)
    }, 150)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="hud">
      {sceneId === 'lobby' ? (
        <div className="hud__pill hud__pill--lobby">{s.lobby}</div>
      ) : (
        <>
          <div className="hud__pill">
            <span className="hud__star" aria-hidden>★</span>
            <b>{stars}</b>
            <span className="hud__dim">/ {total}</span>
          </div>
          {secretsTotal > 0 && (
            <div className="hud__pill hud__pill--secret" key={secrets}>
              {s.secret} <b>{secrets}</b>
              <span className="hud__dim">/ {secretsTotal}</span>
            </div>
          )}
          <div className="hud__pill hud__pill--time">{formatTime(time)}</div>
        </>
      )}
      {grabbing && <div className="hud__pill hud__pill--grab">{s.holding}</div>}
      <div className="hud__legend">
        {s.legend.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  )
}

/** «Круг больше / меньше» — во столько раз за нажатие. */
const RING_STEP = 1.15
/** «Поворот мира медленнее / быстрее» — во столько раз за нажатие. */
const GRAB_STEP = 1.2

export function PauseMenu() {
  const [setup, setSetup] = useState(false)
  const [ring, setRing] = useState(palmRingScale)
  const [grab, setGrab] = useState(grabSpeed)
  const g = useGame.getState()
  const s = useT().menu
  const { lang, setLang } = useLang()
  if (setup) return <RingSetup onDone={() => setSetup(false)} />
  return (
    <div className="screen screen--dim">
      <div className="card">
        <h2 className="title title--small">{s.title}</h2>
        <p className="lead">{s.lead}</p>
        <div className="row">
          <DwellButton onActivate={() => g.setPhase('playing')}>{s.resume}</DwellButton>
          <DwellButton variant="ghost" onActivate={() => g.restart()}>
            {s.restart}
          </DwellButton>
          {g.sceneId !== 'lobby' && (
            <DwellButton variant="ghost" onActivate={() => g.goToScene('lobby')}>
              {s.lobby}
            </DwellButton>
          )}
        </div>
        <h3 className="menu__section">{s.grab(Math.round(grab * 100))}</h3>
        <div className="row row--tight">
          <DwellButton variant="ghost" onActivate={() => setGrab(scaleGrabSpeed(1 / GRAB_STEP))}>
            {s.slower}
          </DwellButton>
          <DwellButton variant="ghost" onActivate={() => setGrab(scaleGrabSpeed(GRAB_STEP))}>
            {s.faster}
          </DwellButton>
        </div>
        <h3 className="menu__section">{s.ring(Math.round(ring * 100))}</h3>
        <div className="row row--tight">
          <DwellButton variant="ghost" onActivate={() => setRing(resizePalmRing(1 / RING_STEP))}>
            {s.smaller}
          </DwellButton>
          <DwellButton variant="ghost" onActivate={() => setRing(resizePalmRing(RING_STEP))}>
            {s.bigger}
          </DwellButton>
          <DwellButton variant="ghost" onActivate={() => setSetup(true)}>
            {s.place}
          </DwellButton>
        </div>
        <h3 className="menu__section">{s.langTitle}</h3>
        <div className="row row--tight">
          <DwellButton variant="ghost" onActivate={() => setLang(lang === 'en' ? 'ru' : 'en')}>
            {s.otherLang}
          </DwellButton>
        </div>
      </div>
    </div>
  )
}

/** Сколько держать раскрытую ладонь, чтобы круг встал под неё. */
const SETUP_HOLD_MS = 1000
/** Руки не видно столько — возвращаемся в меню. */
const SETUP_GIVE_UP_MS = 10000

/** «Поставить круг заново»: подними правую ладонь, где руке удобно, подержи секунду — круг встанет туда. */
function RingSetup({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0)
  const s = useT().menu
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    beginJoystickCalibration()
    let raf = 0
    let last = performance.now()
    let held = 0
    let away = 0
    let frame = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(100, now - last)
      last = now
      const r = control.hands.right
      held = r?.openPalm ? held + dt : Math.max(0, held - dt * 2)
      away = r ? 0 : away + dt
      if (frame++ % 3 === 0) setProgress(Math.min(1, held / SETUP_HOLD_MS))
      if (held >= SETUP_HOLD_MS) {
        cancelAnimationFrame(raf)
        calibrateJoystick()
        sfx.confirm()
        setProgress(1)
        setTimeout(() => done.current(), 400)
      } else if (away > SETUP_GIVE_UP_MS) {
        cancelAnimationFrame(raf)
        done.current()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      endJoystickCalibration()
    }
  }, [])

  return (
    <div className="screen screen--dim">
      <div className="card">
        <h2 className="title title--small">{s.setupTitle}</h2>
        <p className="lead">{s.setupLead}</p>
        <div className="bar">
          <div className="bar__fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="fine">{s.setupFine}</p>
      </div>
    </div>
  )
}
