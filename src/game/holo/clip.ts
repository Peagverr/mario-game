/**
 * Клип руки для голограммы: 21 точка MediaPipe во времени.
 *
 * Координаты — метры, как worldLandmarks MediaPipe, центр — примерно середина ладони.
 * Оси — как видит игрок на экране, ЗЕРКАЛЬНО (как своя рука в зеркале):
 *   x вправо, y вверх, z — к зрителю (из экрана). Ладонь к камере = ладонь к игроку.
 * Перевод из worldLandmarks трекера (x уже зеркальный, y вниз, z от камеры): (x, −y, −z).
 *
 * Файл клипа (JSON, поле v = 1):
 *   { v, name, hand: 'right' | 'left', fps, q, frames: number[][], move?: number[][], ring?: number }
 *   frames[i] — 63 целых: x0,y0,z0, x1,y1,z1 … (метры = число · q; q = 0.0005 → шаг полмиллиметра);
 *   move[i]   — 3 целых: сдвиг всей ладони в кадре i (например, «вынеси ладонь из круга вверх»);
 *   ring      — радиус круга-джойстика (м), который рисуется за ладонью в её начальном месте.
 * Процедурные и записанные клипы — один формат: запись можно положить в clips/ и она заменит процедурную.
 */

export type HandSide = 'right' | 'left'

export type ClipFile = {
  v: 1
  name: string
  hand: HandSide
  fps: number
  /** Шаг квантования, м. */
  q: number
  frames: number[][]
  move?: number[][]
  ring?: number
}

/** Клип в памяти: точки сплошным массивом, чтобы выборка кадра шла без новых объектов. */
export type HandClip = {
  name: string
  hand: HandSide
  fps: number
  /** Кадров. */
  count: number
  /** Длительность цикла, с: последний кадр плавно переходит в первый. */
  duration: number
  /** count · 63 чисел, метры. */
  points: Float32Array
  /** count · 3 чисел, метры. */
  move: Float32Array
  ring: number
}

export const POINTS = 21
export const FRAME_LEN = POINTS * 3
export const DEFAULT_Q = 0.0005

export function makeClip(name: string, hand: HandSide, fps: number, frames: ArrayLike<number>[], move?: ArrayLike<number>[], ring = 0): HandClip {
  const count = frames.length
  if (!count) throw new Error(`[holo] клип ${name} пустой`)
  const points = new Float32Array(count * FRAME_LEN)
  const mv = new Float32Array(count * 3)
  frames.forEach((f, i) => {
    if (f.length !== FRAME_LEN) throw new Error(`[holo] клип ${name}: в кадре ${i} ${f.length} чисел, нужно ${FRAME_LEN}`)
    points.set(f, i * FRAME_LEN)
    if (move?.[i]) mv.set(move[i], i * 3)
  })
  return { name, hand, fps, count, duration: count / fps, points, move: mv, ring }
}

/** Клип → компактный JSON: целые с шагом q. Сдвиг пишем, только если он не нулевой. */
export function encodeClip(c: HandClip, q = DEFAULT_Q): ClipFile {
  const frames: number[][] = []
  const move: number[][] = []
  let moves = false
  for (let i = 0; i < c.count; i++) {
    frames.push(Array.from(c.points.subarray(i * FRAME_LEN, (i + 1) * FRAME_LEN), (v) => Math.round(v / q)))
    const m = Array.from(c.move.subarray(i * 3, i * 3 + 3), (v) => Math.round(v / q))
    if (m.some((v) => v !== 0)) moves = true
    move.push(m)
  }
  const file: ClipFile = { v: 1, name: c.name, hand: c.hand, fps: c.fps, q, frames }
  if (moves) file.move = move
  if (c.ring) file.ring = c.ring
  return file
}

export function decodeClip(f: ClipFile): HandClip {
  if (f.v !== 1) throw new Error(`[holo] клип ${f.name}: неизвестная версия ${f.v}`)
  const scale = (a: number[]) => a.map((v) => v * f.q)
  return makeClip(f.name, f.hand, f.fps, f.frames.map(scale), f.move?.map(scale), f.ring ?? 0)
}

/**
 * Кадр в момент t (с), по кругу: линейно между соседними кадрами, после последнего — назад к первому.
 * Пишет в out (63 числа) и outMove (3 числа) — без выделения памяти, можно звать каждый кадр.
 */
export function sampleClip(c: HandClip, t: number, out: Float32Array, outMove: Float32Array) {
  const f = (((t % c.duration) + c.duration) % c.duration) * c.fps
  const i0 = Math.floor(f) % c.count
  const i1 = (i0 + 1) % c.count
  const k = f - Math.floor(f)
  const a = i0 * FRAME_LEN
  const b = i1 * FRAME_LEN
  for (let j = 0; j < FRAME_LEN; j++) out[j] = c.points[a + j] + (c.points[b + j] - c.points[a + j]) * k
  for (let j = 0; j < 3; j++) outMove[j] = c.move[i0 * 3 + j] + (c.move[i1 * 3 + j] - c.move[i0 * 3 + j]) * k
}
