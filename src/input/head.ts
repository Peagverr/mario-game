import type { Point } from '../shared/controlState'

/**
 * Положение головы относительно центра экрана — для эффекта «окна».
 *
 * Идея: расстояние между зрачками у людей почти одинаковое (~63 мм). Чем меньше оно в кадре,
 * тем дальше голова от камеры. Зная угол обзора камеры, переводим пиксели в метры.
 */

const IPD_M = 0.063
/** Типичный горизонтальный угол обзора камеры ноутбука. */
const CAMERA_HFOV_DEG = 62
/** Камера ноутбука обычно над экраном: центр экрана примерно на 10 см ниже. */
const CAMERA_ABOVE_SCREEN_CENTER_M = 0.1

export const LEFT_IRIS = 468
export const RIGHT_IRIS = 473

export function estimateHead(points: Point[], videoW: number, videoH: number, yawDeg: number) {
  const l = points[LEFT_IRIS]
  const r = points[RIGHT_IRIS]
  const focal = videoW / 2 / Math.tan(((CAMERA_HFOV_DEG / 2) * Math.PI) / 180)

  // При повороте головы зрачки в кадре сближаются — поправляем, чтобы не казалось, что голова отдалилась.
  const yawFix = Math.max(0.5, Math.cos((yawDeg * Math.PI) / 180))
  const ipdPx = Math.hypot((l.x - r.x) * videoW, (l.y - r.y) * videoH) / yawFix
  const z = (IPD_M * focal) / Math.max(ipdPx, 1)

  const mx = (l.x + r.x) / 2
  const my = (l.y + r.y) / 2
  const x = ((mx - 0.5) * videoW * z) / focal
  const y = (-(my - 0.5) * videoH * z) / focal + CAMERA_ABOVE_SCREEN_CENTER_M
  return { x, y, z }
}

/** Поворот головы влево-вправо в градусах из матрицы MediaPipe (4×4, по столбцам). */
export function yawFromMatrix(m: ArrayLike<number>): number {
  return (Math.atan2(m[8], m[10]) * 180) / Math.PI
}

/** Точки лица для мини-окна: зрачки и немного контура — чтобы было видно, что лицо найдено. */
export const FACE_PREVIEW_POINTS = [
  LEFT_IRIS, RIGHT_IRIS,
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]
