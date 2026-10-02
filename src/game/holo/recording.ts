import type { Point } from '../../shared/controlState'
import { FRAME_LEN, makeClip, type HandClip, type HandSide } from './clip'

/**
 * Запись живой руки → клип голограммы.
 * Кадры трекера приходят неровно (25–30 в секунду), поэтому пересчитываем их на ровную частоту.
 * Форма руки — из worldLandmarks (метры): переворачиваем y и z в оси клипа.
 * Сдвиг ладони — из картинки: смещение центра ладони от первого кадра, переведённое в метры
 * по размеру ладони (на картинке и в метрах — одно и то же расстояние «запястье → основание среднего»).
 */

export type RecordedSample = {
  /** Время, с. */
  t: number
  /** 21 объёмная точка трекера (x зеркально, y вниз, z от камеры), м. */
  world: Point[]
  /** Центр ладони на картинке (0..1, зеркально). */
  palm: Point
  /** Размер ладони на картинке в «квадратных» координатах (как HandState.size). */
  size: number
}

export function recordingToClip(samples: RecordedSample[], name: string, hand: HandSide, aspect: number, fps = 30): HandClip {
  if (samples.length < 2) throw new Error('[holo] запись слишком короткая')
  const t0 = samples[0].t
  const duration = samples[samples.length - 1].t - t0
  const count = Math.max(2, Math.round(duration * fps))
  const p0 = samples[0].palm

  // Каждый кадр записи → точки в осях клипа и сдвиг ладони в метрах.
  const shaped = samples.map((s) => {
    const pts = new Float32Array(FRAME_LEN)
    s.world.forEach((p, i) => {
      pts[i * 3] = p.x
      pts[i * 3 + 1] = -p.y
      pts[i * 3 + 2] = -p.z
    })
    const w = s.world
    const metersPerUnit = Math.hypot(w[0].x - w[9].x, w[0].y - w[9].y, w[0].z - w[9].z) / (s.size || 1e-6)
    const move = [(s.palm.x - p0.x) * aspect * metersPerUnit, -(s.palm.y - p0.y) * metersPerUnit, 0]
    return { t: s.t - t0, pts, move }
  })

  const frames: Float32Array[] = []
  const moves: number[][] = []
  let j = 0
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * duration
    while (j < shaped.length - 2 && shaped[j + 1].t < t) j++
    const a = shaped[j]
    const b = shaped[j + 1]
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0
    const f = new Float32Array(FRAME_LEN)
    for (let c = 0; c < FRAME_LEN; c++) f[c] = a.pts[c] + (b.pts[c] - a.pts[c]) * k
    frames.push(f)
    moves.push(a.move.map((v, c) => v + (b.move[c] - v) * k))
  }
  return makeClip(name, hand, fps, frames, moves)
}
