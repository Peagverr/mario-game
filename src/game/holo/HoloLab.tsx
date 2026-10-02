import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { control } from '../../shared/controlState'
import { labAdvance, LabStage } from '../LabStage'
import { runtime } from '../runtime'
import { CLIP_NAMES } from './clips'
import { HoloHand } from './HoloHand'
import type { HoloCue } from './holoCue'
import { labState, type View } from './labState'
import { Recorder } from './Recorder'

/**
 * Стенд для проверки голограммы глазами (`?holo`): настоящий мир лобби, тот же свет и постобработка,
 * рука по кругу показывает все клипы, каждый раз появляясь и рассыпаясь.
 * Клавиши: 1 — рядом с героем (фон — трава), 2 — на фоне неба, 3 — у каменного портала,
 * Z — крупно, Q — слабое качество, пробел — пауза цикла. `?record` — ещё и запись своей руки (Recorder).
 * `&shot` — время стоит, кадры двигает скрипт: `__holo.advance(секунды)` (см. LabStage).
 */

/** Где рука (от героя), земля под ней и наклон взгляда (как щипком: меньше — смотрим ровнее, за рукой стена или небо). */
const VIEWS: Record<View, { at: [number, number, number]; ground: number; pitch: number }> = {
  hero: { at: [2.6, 1.95, 0.9], ground: 0, pitch: 0 },
  sky: { at: [2.7, 2.9, -6.8], ground: 0, pitch: 0 },
  stone: { at: [-1.5, 1.9, -3.2], ground: 0, pitch: -0.22 },
}

/** Сколько показывать клип (с) и пауза между клипами. */
const SHOW_S = 5.2
const GAP_S = 1.4

function Cycler({ cue }: { cue: HoloCue }) {
  const st = useMemo(() => ({ t: 0, i: -1, shown: false }), [])
  useFrame((_, dt) => {
    if (labState.paused) return
    st.t -= dt
    if (st.t > 0) return
    if (!st.shown) {
      st.i = labState.pin ? CLIP_NAMES.indexOf(labState.pin as never) : (st.i + 1) % CLIP_NAMES.length
      cue.clip = labState.pin ?? CLIP_NAMES[st.i]
      labState.pin = null
      cue.cue++
      cue.matched = false
      st.shown = true
      st.t = SHOW_S
    } else {
      cue.matched = true
      st.shown = false
      st.t = GAP_S
    }
  })
  return null
}

function LabHand() {
  const cue = useMemo<HoloCue>(() => ({ clip: null, cue: 0, matched: false }), [])
  const target = useMemo(() => new Vector3(), [])
  const [view, setView] = useState<View>(labState.view)
  useFrame(() => {
    if (labState.view !== view) setView(labState.view)
    const v = VIEWS[labState.view]
    target.set(...v.at).add(runtime.playerPos).setY(v.at[1])
    control.view.zoom = labState.zoom
    control.view.pitch = v.pitch
    runtime.lowQuality = labState.low
  })
  // Для проверки из консоли и автоматических скриншотов.
  useEffect(() => void Object.assign(window, { __holo: { lab: labState, cue, advance: labAdvance } }), [cue])
  return (
    <>
      <Cycler cue={cue} />
      <HoloHand cue={cue} target={target} groundY={VIEWS[view].ground} />
    </>
  )
}

export function HoloLab({ record }: { record: boolean }) {
  const [low, setLow] = useState(false)
  const [label, setLabel] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Digit1') labState.view = 'hero'
      if (e.code === 'Digit2') labState.view = 'sky'
      if (e.code === 'Digit3') labState.view = 'stone'
      if (e.code === 'KeyZ') labState.zoom = labState.zoom > 1 ? 1 : 2.4
      if (e.code === 'KeyQ') setLow((labState.low = !labState.low))
      if (e.code === 'Space' && !record) labState.paused = !labState.paused
      setLabel(`${labState.view} · ×${labState.zoom}${labState.low ? ' · low' : ''}${labState.paused ? ' · пауза' : ''}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [record])

  return (
    <div className="app">
      <LabStage low={low}>
        <LabHand />
      </LabStage>
      <div className="holo-lab__label">
        голограмма · 1 герой · 2 небо · 3 камень · Z крупно · Q качество{label && ` — ${label}`}
      </div>
      {record && <Recorder />}
    </div>
  )
}
