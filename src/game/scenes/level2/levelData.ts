import type { Platform } from '../level1/levelData'

/**
 * Уровень 2 «Загляни» — только данные.
 * Дворики — квадраты из высоких стен с тайной звездой внутри: с обычного ракурса внутрь не видно,
 * надо поднять голову (эффект окна) или наклонить мир левым кулаком. Увидел звезду — она твоя.
 */

export type Courtyard = { x: number; z: number; top: number; size: number; height: number }

export const level2 = {
  spawn: [0, 1.2, 1.5] as [number, number, number],
  platforms: [
    { x: 0, z: 0, top: 0, w: 10, d: 9, h: 2.4, kind: 'island', checkpoint: true, trees: [[-3.8, 3.2]] },
    { x: 7.4, z: -1, top: 0.2, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
    { x: 14, z: -1.5, top: 0.6, w: 9, d: 9, h: 2.4, kind: 'island', checkpoint: true, trees: [[3.4, 3.4]] },
    { x: 14, z: -8.4, top: 0.6, w: 2.2, d: 4, h: 0.4, kind: 'wood' },
    { x: 14, z: -15, top: 1.2, w: 10, d: 9, h: 2.4, kind: 'island', checkpoint: true },
    { x: 6.6, z: -15, top: 1.6, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
    { x: 0, z: -15, top: 2.0, w: 9, d: 9, h: 2.6, kind: 'island', checkpoint: true, trees: [[-3.4, -3.4]] },
  ] satisfies Platform[] as Platform[],
  // Стены 3 м: перепрыгнуть нельзя (прыжок ~1,8 м), а заглянуть — хватает поднять голову на 5–7 см.
  courtyards: [
    { x: 2.5, z: -2.2, top: 0, size: 3.2, height: 3 },
    { x: 15.5, z: -3.2, top: 0.6, size: 3.2, height: 3 },
    { x: 11.5, z: -16.2, top: 1.2, size: 3.2, height: 3 },
    { x: 16.8, z: -13.2, top: 1.2, size: 3.2, height: 3 },
  ] as Courtyard[],
  /** Обычные звёзды — на пути, чтобы было что собирать между двориками. */
  stars: [
    [-2.5, 1, -1.5],
    [7.4, 1.3, -1],
    [12, 1.6, 1],
    [14, 1.6, -8.4],
    [6.6, 2.7, -15],
  ] as [number, number, number][],
  /** Ворота перед финишем: откроются, когда найдены все тайные звёзды. */
  gate: { x: 3.9, z: -15, top: 2.0, width: 3.4 },
  goal: [-1.5, 2.0, -16.5] as [number, number, number],
  killY: -10,
}

type Vec3 = [number, number, number]

/** Толщина стен двориков. */
export const WALL_T = 0.35
/** Тайная звезда висит на такой высоте над полом дворика: без движения головы её не видно ни с какой стороны, а поднять голову хватает на 7 см. */
export const SECRET_STAR_HEIGHT = 1.85
/** Звезда засчитана, когда с камеры видно столько точек из шести (центр и пять лучей) — хотя бы половина звезды. */
export const SEEN_POINTS = 3
/** Лучи звезды: радиус точек проверки (у самой звезды — 0.55). */
const TIP = 0.5

/** Четыре стены дворика: центр и размеры каждой — относительно центра дворика на уровне его пола. */
export function courtyardWalls(c: Courtyard): { pos: Vec3; size: Vec3 }[] {
  const half = c.size / 2
  return [
    { pos: [0, c.height / 2, -half], size: [c.size + WALL_T, c.height, WALL_T] },
    { pos: [0, c.height / 2, half], size: [c.size + WALL_T, c.height, WALL_T] },
    { pos: [-half, c.height / 2, 0], size: [WALL_T, c.height, c.size] },
    { pos: [half, c.height / 2, 0], size: [WALL_T, c.height, c.size] },
  ]
}

/**
 * Точки звезды, которые проверяем на «видно»: центр и пять лучей — в плоскости, повёрнутой к камере
 * (right — направление «вправо» для камеры, вверх — всегда вверх). Видна верхняя половина — это уже 3 точки.
 */
export function starSamplePoints(center: Vec3, right: Vec3): Vec3[] {
  const [cx, cy, cz] = center
  const tips = [0, 1, 2, 3, 4].map((i): Vec3 => {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2
    const side = Math.cos(a) * TIP
    return [cx + right[0] * side, cy + Math.sin(a) * TIP, cz + right[2] * side]
  })
  return [center, ...tips]
}
