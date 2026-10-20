import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { control } from '../shared/controlState'
import { framesPerRender, isTrackingSlow, refreshRate, SLOW_WINDOW } from './pacing'

/** Замер распознавания раз в столько мс; первые WARMUP_MS после старта камеры не считаем — там прогрев. */
const SAMPLE_MS = 250
const WARMUP_MS = 2000
/** По скольким последним интервалам между кадрами экрана считаем его частоту. */
const REFRESH_SAMPLES = 120

/**
 * Облегчённый режим (почему и что — в pacing.ts). Следит за временем распознавания и, если оно устойчиво
 * медленное, зовёт onSlow (сглаживание SMAA вместо MSAA ×4 — в GameCanvas). В облегчённом режиме на быстром
 * экране сам ведёт кадры: рисует каждый второй кадр экрана (frameloop 'never' + advance).
 */
export function RenderPacer({ light, onSlow }: { light: boolean; onSlow: () => void }) {
  const setFrameloop = useThree((s) => s.setFrameloop)
  const advance = useThree((s) => s.advance)
  const clock = useThree((s) => s.clock)

  useEffect(() => {
    if (light) return
    const samples: number[] = []
    let since = 0
    const iv = setInterval(() => {
      const tr = control.tracking
      // Считаем, только пока кадры с камеры идут и распознаются.
      if (!tr.ready || tr.camera !== 'ok' || tr.fps < 5) {
        since = 0
        samples.length = 0
        return
      }
      since ||= performance.now()
      if (performance.now() - since < WARMUP_MS) return
      samples.push(tr.inferMs)
      if (samples.length > SLOW_WINDOW) samples.shift()
      if (isTrackingSlow(samples)) onSlow()
    }, SAMPLE_MS)
    return () => clearInterval(iv)
  }, [light, onSlow])

  useEffect(() => {
    if (!light) return
    let raf = 0
    let last = 0
    let lastRender = 0
    let frame = 0
    let paced = false
    const intervals: number[] = []
    const paceFrame = (t: number) => {
      raf = requestAnimationFrame(paceFrame)
      if (last) {
        intervals.push(t - last)
        if (intervals.length > REFRESH_SAMPLES) intervals.shift()
      }
      last = t
      const every = framesPerRender(refreshRate(intervals))
      if (!paced) {
        if (every === 1) return
        // Кадры ведём сами. setFrameloop обнуляет часы сцены — возвращаем время, иначе небо и звёзды прыгнут.
        const elapsed = clock.elapsedTime
        setFrameloop('never')
        clock.elapsedTime = elapsed
        paced = true
        lastRender = t
        frame = 0
      }
      if (frame++ % every) return
      advance(clock.elapsedTime + (t - lastRender) / 1000)
      lastRender = t
    }
    raf = requestAnimationFrame(paceFrame)
    return () => {
      cancelAnimationFrame(raf)
      if (paced) {
        const elapsed = clock.elapsedTime
        setFrameloop('always')
        clock.elapsedTime = elapsed
      }
    }
  }, [light, setFrameloop, advance, clock])

  return null
}
