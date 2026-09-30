/**
 * Ходьба героя — правила без физики, их проверяют тесты (walk.test.ts). Физику и лучи вниз делает Player.tsx.
 */

export type Vec2 = { x: number; z: number }
/** Есть ли под точкой земля (в игре — луч вниз, не дальше обрыва). */
export type GroundAt = (x: number, z: number) => boolean

/** Насколько впереди центра героя ищем землю (радиус героя + запас). */
export const EDGE_PROBE = 0.6
/** Впереди обрыв, но в пределах этого вбок есть земля (мост) — съезжаем к ней вдоль края. */
const ASSIST = 1
const ASSIST_STEP = 0.2
/** Возле оси мира направление притягивается к ней: мосты и острова стоят по осям. */
const SNAP = (20 * Math.PI) / 180
const AXES: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]

/** Направление ходьбы в мире: рядом с осью — ровно по оси, скорость не меняется. */
export function snapToAxes(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z)
  if (len < 1e-6) return { x: 0, z: 0 }
  const a = Math.atan2(z, x)
  const axis = Math.round(a / (Math.PI / 2))
  if (Math.abs(a - (axis * Math.PI) / 2) >= SNAP) return { x, z }
  const [ax, az] = AXES[((axis % 4) + 4) % 4]
  return { x: ax * len, z: az * len }
}

/**
 * Мягкие края: шагом с обрыва не упасть, через пропасть — только прыжком.
 * Но если прямо впереди обрыв, а чуть вбок есть земля (подходишь к мосту не по центру), герой не упирается,
 * а съезжает к ней вдоль края и заходит на мост. carry — скорость движущейся платформы под ногами.
 */
export function softEdges(pos: Vec2, vel: Vec2, groundAt: GroundAt, carry: Vec2 = { x: 0, z: 0 }): Vec2 {
  const ox = vel.x - carry.x
  const oz = vel.z - carry.z
  const px = Math.abs(ox) > 0.1 ? pos.x + Math.sign(ox) * EDGE_PROBE : pos.x
  const pz = Math.abs(oz) > 0.1 ? pos.z + Math.sign(oz) * EDGE_PROBE : pos.z
  let vx = vel.x
  let vz = vel.z
  // По осям отдельно — чтобы герой скользил вдоль края, а не застревал.
  if (px !== pos.x && !groundAt(px, pos.z)) {
    vx = carry.x
    if (pz === pos.z) vz = carry.z + nearestSide((d) => groundAt(px, pos.z + d)) * Math.abs(ox)
  }
  if (pz !== pos.z && !groundAt(pos.x, pz)) {
    vz = carry.z
    if (px === pos.x) vx = carry.x + nearestSide((d) => groundAt(pos.x + d, pz)) * Math.abs(oz)
  }
  if (vx !== carry.x && vz !== carry.z && px !== pos.x && pz !== pos.z && !groundAt(px, pz)) {
    vx = carry.x
    vz = carry.z
  }
  return { x: vx, z: vz }
}

/** Физика шагает на время кадра, но не дольше этого (так устроен @react-three/rapier с timeStep="vary"). */
const PHYSICS_MAX_STEP = 0.5
/** За один шаг физики герой проходит не больше этого — меньше, чем проверка края впереди (EDGE_PROBE). */
const MAX_STEP_DIST = 0.45

/**
 * Кадр подвис (вкладку свернули и вернули, сборка мусора) — физика делает один длинный шаг, и на полной скорости
 * герой проскочил бы мягкий край. Ограничиваем скорость так, чтобы за шаг он прошёл меньше, чем проверка края.
 * На обычных кадрах (60 к/с) не меняется ничего.
 */
export function capStep(x: number, z: number, frameDt: number): Vec2 {
  const step = Math.min(frameDt, PHYSICS_MAX_STEP)
  const speed = Math.hypot(x, z)
  const max = MAX_STEP_DIST / Math.max(step, 1e-3)
  return speed > max ? { x: (x / speed) * max, z: (z / speed) * max } : { x, z }
}

/** С какой стороны (−1 или +1) ближе всего земля в пределах ASSIST; 0 — нигде или с обеих сторон сразу. */
function nearestSide(hasGround: (offset: number) => boolean) {
  for (let d = ASSIST_STEP; d <= ASSIST + 1e-9; d += ASSIST_STEP) {
    const plus = hasGround(d)
    const minus = hasGround(-d)
    if (plus !== minus) return plus ? 1 : -1
    if (plus) return 0
  }
  return 0
}
