/**
 * Из чего собрана голограмма: штрихи-кости и узлы-суставы поверх 21 точки MediaPipe.
 *
 * Иерархия яркости (от главного к фону): кончики > суставы > кости пальцев > края ладони > лучи внутри ладони.
 * depth — «сколько суставов от запястья»: по нему кости вырастают при появлении и втягиваются при исчезновении.
 * s — доля пути от запястья к кончику: по нему бежит импульс света.
 * Радиусы — в метрах руки (рука 18 см): пальцы толще у ладони и тоньше к кончикам.
 */

export type Stroke = {
  a: number
  b: number
  /** Радиус у начала и у конца, м. */
  ra: number
  rb: number
  /** Сколько белого ядра (0 — только цветное тело) и общая яркость. */
  core: number
  gain: number
  /** Прозрачность: лучи внутри ладони — полупрозрачные, пальцы — плотные. */
  alpha: number
  depth: number
  /** Порядок пальца для волны появления: 0 большой … 4 мизинец. */
  finger: number
}

export type Joint = { i: number; r: number; core: number; gain: number; depth: number; finger: number }

const S = [0, 0.2, 0.45, 0.72, 1, 0.35, 0.6, 0.8, 1, 0.35, 0.6, 0.8, 1, 0.35, 0.6, 0.8, 1, 0.35, 0.6, 0.8, 1]
/** Доля пути «запястье → кончик» для каждой точки. */
export const CHAIN_S = Float32Array.from(S)

const fingerOf = (i: number) => (i === 0 ? 0 : i <= 4 ? 0 : Math.floor((i - 5) / 4) + 1)
/** Запястье 0, основания пальцев 1, дальше по суставу +1, кончики 4 (у большого так же: 1 — основание, 4 — кончик). */
const depthOf = (i: number) => (i === 0 ? 0 : i <= 4 ? i : ((i - 5) % 4) + 1)

const palm = (a: number, b: number, edge: boolean): Stroke => ({
  a,
  b,
  ra: edge ? 0.0052 : 0.0026,
  rb: edge ? 0.0046 : 0.0022,
  core: edge ? 0.5 : 0,
  gain: edge ? 0.9 : 0.75,
  alpha: edge ? 1 : 0.6,
  depth: 0,
  finger: fingerOf(b),
})

/**
 * Фаланги: радиусы [у основания, у конца] по глубине кости (1 — основная, 2 — средняя, 3 — ногтевая).
 * Штрих ~70% толщины настоящего пальца: это «рука из света», а не скелет из палочек.
 */
const FINGER_R = [
  [0, 0],
  [0.0068, 0.0058],
  [0.0056, 0.0048],
  [0.0047, 0.0038],
]

const finger = (a: number, b: number): Stroke => {
  const d = depthOf(a)
  return { a, b, ra: FINGER_R[d][0], rb: FINGER_R[d][1], core: 1, gain: 1, alpha: 1, depth: d, finger: fingerOf(b) }
}

export const STROKES: Stroke[] = [
  // Ладонь: края (к указательному, к мизинцу, к основанию большого) и тонкие лучи-пястные кости внутри.
  palm(0, 1, true),
  palm(0, 5, true),
  palm(0, 17, true),
  palm(0, 9, false),
  palm(0, 13, false),
  { ...palm(5, 9, false), depth: 1 },
  { ...palm(9, 13, false), depth: 1 },
  { ...palm(13, 17, false), depth: 1 },
  // Пальцы.
  finger(1, 2), finger(2, 3), finger(3, 4),
  finger(5, 6), finger(6, 7), finger(7, 8),
  finger(9, 10), finger(10, 11), finger(11, 12),
  finger(13, 14), finger(14, 15), finger(15, 16),
  finger(17, 18), finger(18, 19), finger(19, 20),
]

const TIPS = [4, 8, 12, 16, 20]
/**
 * Суставы — яркие «блики» ВНУТРИ штриха (меньше его толщины), а не бусины поверх: рука не выглядит
 * шарнирной куклой. Кончики — самые яркие точки руки, запястье — мягкий «источник», из которого рука вырастает.
 */
export const JOINTS: Joint[] = Array.from({ length: 21 }, (_, i) => {
  const tip = TIPS.includes(i)
  const d = depthOf(i)
  const r = i === 0 ? 0.0075 : tip ? 0.0042 : [0, 0.0048, 0.0042, 0.0036][d] ?? 0.004
  return { i, r, core: 1, gain: tip ? 1.5 : i === 0 ? 1.2 : 1.15, depth: d, finger: fingerOf(i) }
})

/** Контур ладони для заливки: запястье → основание большого → костяшки. */
export const PALM_OUTLINE = [0, 1, 2, 5, 9, 13, 17]
