import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { control } from '../../shared/controlState'
import { useGame } from '../../shared/gameStore'
import { labAdvance, LabStage } from '../LabStage'
import { runtime } from '../runtime'
import { Spirit } from './Spirit'
import { spirit, spiritAlert, spiritAppear, spiritCelebrate, spiritFollow, spiritGuide, spiritVanish } from './spiritState'

/**
 * Стенд духа Окна (`?spirit`): настоящий мир лобби, дух по кругу показывает все поведения —
 * появление, «рядом», праздник, полёт к порталу, прыжок героя, тревога, исчезновение.
 * Клавиши: 1 — у героя (фон — трава), 2 — на фоне неба, 3 — у каменной колонны, Z — крупно,
 * Q — слабое качество, пробел — пауза цикла. `&shot` — кадры двигает скрипт (`__spiritLab.advance`, см. LabStage).
 */

type View = 'hero' | 'sky' | 'stone'
/** Где висит дух для проверки фона (в режиме «у героя» — следует за ним) и наклон взгляда. */
const VIEWS: Record<View, { at: [number, number, number] | null; pitch: number }> = {
  hero: { at: null, pitch: 0 },
  sky: { at: [2.7, 3.1, -5.8], pitch: 0 },
  stone: { at: [-4.0, 1.7, -2.5], pitch: -0.22 },
}
const FIRST_PORTAL = { x: -5.2, y: 1.75, z: -2.5 }

/** Сценарий цикла: [секунда, действие]. */
const SCRIPT: [number, () => void][] = [
  [0, spiritAppear],
  [3, spiritCelebrate],
  [5.5, () => spiritGuide(FIRST_PORTAL, 3.5)],
  [10.5, () => void control.jumpSeq++],
  [13, spiritAlert],
  [15.5, spiritVanish],
]
const CYCLE_S = 17.5

const lab = { view: 'hero' as View, zoom: 1, low: false, paused: false }

function Director() {
  const st = useMemo(() => ({ t: 0, next: 0 }), [])
  useEffect(() => {
    // Прыжок героя работает только в игре — на стенде включаем «игру».
    useGame.getState().setPhase('playing')
    Object.assign(window, {
      __spiritLab: { lab, spirit, advance: labAdvance, appear: spiritAppear, vanish: spiritVanish, celebrate: spiritCelebrate, alert: spiritAlert, guide: spiritGuide, follow: spiritFollow },
    })
  }, [])
  useFrame((_, dt) => {
    control.view.zoom = lab.zoom
    control.view.pitch = VIEWS[lab.view].pitch
    runtime.lowQuality = lab.low
    const at = VIEWS[lab.view].at
    if (at && (spirit.mode !== 'guide' || spirit.guide.x !== at[0])) spiritGuide({ x: at[0], y: at[1], z: at[2] })
    if (!at && spirit.mode === 'guide' && spirit.guide.x !== FIRST_PORTAL.x) spiritFollow()
    if (lab.paused) return
    st.t += dt
    while (st.next < SCRIPT.length && st.t >= SCRIPT[st.next][0]) SCRIPT[st.next++][1]()
    if (st.t >= CYCLE_S) {
      st.t = 0
      st.next = 0
    }
  })
  return null
}

export function SpiritLab() {
  const [low, setLow] = useState(false)
  const [label, setLabel] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Digit1') lab.view = 'hero'
      if (e.code === 'Digit2') lab.view = 'sky'
      if (e.code === 'Digit3') lab.view = 'stone'
      if (e.code === 'KeyZ') lab.zoom = lab.zoom > 1 ? 1 : 2.4
      if (e.code === 'KeyQ') setLow((lab.low = !lab.low))
      if (e.code === 'Space') lab.paused = !lab.paused
      setLabel(`${lab.view} · ×${lab.zoom}${lab.low ? ' · low' : ''}${lab.paused ? ' · пауза' : ''}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="app">
      <LabStage low={low}>
        <Director />
        <Spirit />
      </LabStage>
      <div className="holo-lab__label">
        дух Окна · 1 герой · 2 небо · 3 камень · Z крупно · Q качество · пробел пауза{label && ` — ${label}`}
      </div>
    </div>
  )
}
