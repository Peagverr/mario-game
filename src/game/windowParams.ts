import { Euler, Vector3 } from 'three'

/**
 * Параметры камеры-«окна» — общие для WindowCamera и проверки уровней (например, «Загляни»:
 * насколько надо поднять голову, чтобы заглянуть за стену).
 */

/** Предполагаемая ширина экрана ноутбука в метрах (14–15"). */
export const PHYSICAL_SCREEN_W = 0.31
/** Ширина «окна» в единицах мира на уровне героя: сколько мира видно по горизонтали. */
export const WINDOW_W = 14
/** Наклон взгляда вниз. */
export const PITCH = (27 * Math.PI) / 180
/** Пределы наклона левым кулаком: чтобы не уйти под землю и не смотреть строго сверху. */
export const PITCH_MIN = (10 * Math.PI) / 180
export const PITCH_MAX = (60 * Math.PI) / 180
/** Усиление движения головы. */
export const HEAD_GAIN = 2.4
/** Максимальный сдвиг головы от обычного положения, который учитываем (м). */
export const HEAD_MAX = 0.25
/** Расстояние от глаза до окна, когда лица не видно (м). */
export const DEFAULT_EYE_Z = 0.6

/** За сколько секунд «обычное» положение головы догоняет текущее, пока голова почти на месте (поза игрока). */
const NEUTRAL_ADAPT_S = 12
/** Голова сдвинута больше этого (м) — игрок заглядывает нарочно: обычное положение почти не догоняет… */
const NEUTRAL_ZONE = 0.03
/** …только очень медленно — на случай, если он и правда пересел. */
const NEUTRAL_ADAPT_FAR_S = 60

/**
 * «Обычное» положение головы медленно догоняет текущее: поза игрока не сдвигает картинку.
 * Но пока голова заметно поднята или сдвинута (заглядываешь через стену), эффект окна не уплывает.
 */
export function adaptNeutral(neutral: Vector3, head: { x: number; y: number; z: number }, dt: number) {
  const off = Math.hypot(head.x - neutral.x, head.y - neutral.y)
  const tau = off < NEUTRAL_ZONE ? NEUTRAL_ADAPT_S : NEUTRAL_ADAPT_FAR_S
  neutral.lerp(head, 1 - Math.exp(-dt / tau))
}

/**
 * Где камера относительно точки, за которой следим (герой), когда всё успокоилось:
 * голова сдвинута на head (м, от обычного положения), мир наклонён на pitch и повёрнут на yaw.
 * Повторяет то, что WindowCamera делает каждый кадр (окно поворачивается, глаз — в его координатах).
 */
export function cameraOffset(head: { x: number; y: number; z: number }, pitch: number, yaw: number, windowW = WINDOW_W) {
  const scale = windowW / PHYSICAL_SCREEN_W
  const c = (v: number) => Math.min(HEAD_MAX, Math.max(-HEAD_MAX, v))
  const ez = Math.min(1, Math.max(0.35, DEFAULT_EYE_Z + head.z * 0.6))
  const clampedPitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch))
  return new Vector3(c(head.x) * HEAD_GAIN * scale, c(head.y) * HEAD_GAIN * scale, ez * scale).applyEuler(
    new Euler(-clampedPitch, yaw, 0, 'YXZ'),
  )
}
