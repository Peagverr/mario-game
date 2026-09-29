import type { FingerCurl, HandState, Point } from '../shared/controlState'
import { OneEuro3 } from './oneEuro'

/**
 * Собственные правила жестов поверх 21 точки MediaPipe.
 * Все пороги — относительно размера ладони, поэтому работают на любом расстоянии от камеры.
 *
 * Точки MediaPipe: 0 запястье; большой 1–4; указательный 5–8; средний 9–12; безымянный 13–16; мизинец 17–20.
 */

export const FINGER_NAMES = ['большой', 'указательный', 'средний', 'безымянный', 'мизинец'] as const
/** Точки каждого пальца (для подсветки на скелете). */
export const FINGER_POINTS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
]

/** Кончик пальца дальше основания во столько раз (от запястья) → палец выпрямлен. */
const EXTENDED_RATIO = 1.5
/** …ближе этого → согнут. Между порогами — «наполовину». */
const CURLED_RATIO = 1.2

/** Щипок: включается, когда пальцы ближе PINCH_ON, выключается дальше PINCH_OFF (запас против мигания). */
export const PINCH_ON = 0.4
export const PINCH_OFF = 0.62
/** Щипок не отпускается, пока пальцы разведены меньше этого времени — один плохой кадр его не оборвёт. */
const PINCH_RELEASE_MS = 150

/** Переводит точку в «квадратные» координаты, чтобы расстояния по x и y были сравнимы. */
function sq(p: Point, aspect: number) {
  return { x: p.x * aspect, y: p.y, z: p.z * aspect }
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * Согнуты ли пальцы. Считаем по объёмным координатам руки в метрах (worldLandmarks MediaPipe):
 * они не зависят от того, как рука повёрнута к камере, в отличие от плоской картинки.
 */
export function fingerCurls(p: Point[]): FingerCurl[] {
  const wrist = p[0]
  const size = dist(wrist, p[9]) || 1e-6

  const result: FingerCurl[] = []
  // Большой палец: насколько кончик отведён от основания указательного.
  const thumbSpread = dist(p[4], p[5]) / size
  result.push(thumbSpread > 0.55 ? 'extended' : thumbSpread < 0.35 ? 'curled' : 'half')

  // Остальные: кончик от запястья относительно основания пальца от запястья.
  for (const [mcp, , , tip] of FINGER_POINTS.slice(1)) {
    const r = dist(p[tip], wrist) / (dist(p[mcp], wrist) || 1e-6)
    result.push(r > EXTENDED_RATIO ? 'extended' : r < CURLED_RATIO ? 'curled' : 'half')
  }
  return result
}

/** Хранит состояние одной руки между кадрами: сглаживание и «запас» щипка. */
export class HandTracker {
  private pinching = false
  private pinchOpenSince = 0
  private filters = Array.from({ length: 21 }, () => new OneEuro3(1.5, 0.05))
  private worldFilters = Array.from({ length: 21 }, () => new OneEuro3(2.5, 0.1))
  private lastSeen = 0

  /** points — точки на картинке (для положения и скелета), world — объёмные точки в метрах (для формы руки). */
  update(rawPoints: Point[], rawWorld: Point[], gesture: string, aspect: number, t: number): HandState {
    if (t - this.lastSeen > 300) {
      this.filters.forEach((f) => f.reset())
      this.worldFilters.forEach((f) => f.reset())
    }
    this.lastSeen = t
    const points = rawPoints.map((p, i) => this.filters[i].filter(p, t))
    const world = rawWorld.length === 21 ? rawWorld.map((p, i) => this.worldFilters[i].filter(p, t)) : points.map((p) => sq(p, aspect))

    const s = points.map((pt) => sq(pt, aspect))
    const size = dist(s[0], s[9])
    const palmIdx = [0, 5, 9, 13, 17]
    const palm = {
      x: palmIdx.reduce((a, i) => a + points[i].x, 0) / palmIdx.length,
      y: palmIdx.reduce((a, i) => a + points[i].y, 0) / palmIdx.length,
      z: palmIdx.reduce((a, i) => a + points[i].z, 0) / palmIdx.length,
    }

    const curls = fingerCurls(world)
    const curled = curls.map((c) => c === 'curled')
    const fourCurled = curled.slice(1).every(Boolean)
    const fourExtended = curls.slice(1).every((c) => c === 'extended')
    const fist = fourCurled || (gesture === 'Closed_Fist' && curled.slice(1).filter(Boolean).length >= 3)
    const openPalm = fourExtended && curls[0] !== 'curled'

    // Щипок меряем двумя способами и берём меньшее: по объёмным точкам (не зависит от поворота руки)
    // и по картинке (когда рука боком, пальцы закрывают друг друга и объёмные точки «разъезжаются»,
    // а на картинке кончики как раз сливаются). Подушки пальцев толстые — сомкнутые кончики не дают ноль.
    const pinchWorld = dist(world[4], world[8]) / (dist(world[0], world[9]) || 1e-6)
    const pinchImage = dist(s[4], s[8]) / (size || 1e-6)
    const pinchRatio = Math.min(pinchWorld, pinchImage)
    // Указательный не должен быть сжат в кулак — иначе кулак с прижатым большим пальцем выглядит как щипок.
    const indexFree = curls[1] !== 'curled'
    if (this.pinching) {
      if (pinchRatio < PINCH_OFF) this.pinchOpenSince = 0
      else if (!this.pinchOpenSince) this.pinchOpenSince = t
      else if (t - this.pinchOpenSince > PINCH_RELEASE_MS) this.pinching = false
    } else if (pinchRatio < PINCH_ON && indexFree) {
      this.pinching = true
      this.pinchOpenSince = 0
    }

    return {
      present: true,
      points,
      size,
      palm,
      curls,
      fist,
      openPalm,
      pinchRatio,
      pinching: this.pinching,
      gesture,
    }
  }

  reset() {
    this.pinching = false
    this.pinchOpenSince = 0
    this.filters.forEach((f) => f.reset())
    this.worldFilters.forEach((f) => f.reset())
  }
}
