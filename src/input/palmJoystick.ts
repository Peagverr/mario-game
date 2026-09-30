/**
 * Ладонь у лица (идея Абзала): справа от лица — кольцо-джойстик, его видно в мини-окне камеры.
 *
 * - Пока ладонь не побывала в центре кольца, герой стоит: рука, поднятая снизу, не уводит его назад.
 * - Вышла из центра — идёт туда: вверх — вперёд, вниз — назад, в стороны — вбок
 *   (к осям мира ходьбу притягивает уже сам герой — walk.ts).
 * - Пока рука поднята, кольцо стоит на месте кадра: голова двигается для эффекта окна — герой сам не идёт.
 *   Опустил руку — кольцо снова следует за лицом.
 *
 * Координаты «квадратные»: x·(ширина/высота кадра), y — доли высоты кадра, зеркально (как в мини-окне).
 * Все размеры — в ширинах лица, поэтому не зависят от того, как далеко сидишь от камеры.
 */

export type Vec2 = { x: number; y: number }
/** Лицо: центр между зрачками и ширина от скулы до скулы. */
export type FaceAnchor = { x: number; y: number; w: number }

export type PalmParams = {
  /** Центр кольца относительно лица, в ширинах лица: вправо и вниз. */
  offsetX: number
  offsetY: number
  /** Радиус центра («стоп») и радиус полной скорости, в ширинах лица. */
  dead: number
  full: number
  /** Вниз рука двигается хуже (мешают стол и локоть), поэтому вниз нужно меньшее движение. */
  downGain: number
  /** Скорость сразу за границей центра — доля полной. */
  minSpeed: number
}

export const PALM_DEFAULTS: PalmParams = { offsetX: 1.35, offsetY: 0.8, dead: 0.25, full: 0.55, downGain: 1.3, minSpeed: 0.45 }

/** Руки нет дольше — джойстик снова ждёт ладонь в центре. */
const LOST_MS = 400
/** Руку потеряли на пару кадров — держим последнее движение, чтобы герой не спотыкался. */
const HOLD_MS = 150
/** Запас на возврат в центр: на границе не мигает «иду — стою». */
const HYSTERESIS = 0.04
/** Калибровка не ставит кольцо на лицо и за край кадра. */
const OFFSET_X = [0.9, 2] as const
const OFFSET_Y = [-0.3, 1.6] as const
/** «Круг меньше / больше»: пределы центра, наименьший зазор до полной скорости и её дальний предел (в ширинах лица). */
const DEAD_LIMITS = [0.12, 0.45] as const
const RING_MIN = 0.15
const FULL_MAX = 1
/** Пока лицо ни разу не видели — считаем, что оно в центре кадра 4:3. */
const FALLBACK_FACE: FaceAnchor = { x: (0.5 * 4) / 3, y: 0.4, w: 0.28 }

export type PalmFrame = {
  t: number
  /** Центр правой ладони или null, если руки не видно. */
  palm: Vec2 | null
  /** Лицо, если его видно сейчас. */
  face: FaceAnchor | null
  /** Меню открыто или сейчас не игра — джойстик выключен, после — снова через центр. */
  suspended: boolean
  /** Калибровка в обучении: кольцо под ладонью, герой стоит. */
  calibrating: boolean
  /** Две раскрытые ладони (меню открывается): стоим, но центр не сбрасываем — ладонь могла раскрыться перед щипком. */
  holdStill?: boolean
}

export type PalmState = {
  /** Ходьба: x вправо, y вперёд, длина 0..1. */
  move: Vec2
  /** Ладонь побывала в центре — джойстик слушается. */
  armed: boolean
  moving: boolean
  /** Центр кольца и радиусы — в «квадратных» координатах, для рисования. */
  center: Vec2
  dead: number
  full: number
  /** Кольцо ещё следует за лицом (рука не поднята). */
  faceAnchored: boolean
  /** Куда идём: 0 вправо, 1 вперёд, 2 влево, 3 назад, −1 — стоим. */
  sector: -1 | 0 | 1 | 2 | 3
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

export class PalmJoystick {
  params: PalmParams
  private armed = false
  private moving = false
  /** Пока джойстик взведён, кольцо заморожено: центр и ширина лица на момент взвода. */
  private frozen: { c: Vec2; w: number } | null = null
  private face: FaceAnchor | null = null
  private lastPalmAt = -Infinity
  private last: PalmState | null = null

  constructor(params: PalmParams = PALM_DEFAULTS) {
    this.params = { ...params }
  }

  update(f: PalmFrame): PalmState {
    if (f.face) this.face = f.face
    const face = this.face ?? FALLBACK_FACE
    const p = this.params
    const live = { x: face.x + p.offsetX * face.w, y: face.y + p.offsetY * face.w }
    const idle = (center: Vec2): PalmState => ({
      move: { x: 0, y: 0 },
      armed: false,
      moving: false,
      center,
      dead: p.dead * face.w,
      full: p.full * face.w,
      faceAnchored: !!this.face,
      sector: -1,
    })

    if (f.suspended || f.calibrating) {
      this.disarm()
      if (!f.calibrating || !f.palm) return idle(live)
      // Калибровка: кольцо под ладонью, но не на лице и не за краем кадра.
      const o = this.offsetFor(f.palm, face)
      return idle({ x: face.x + o.x * face.w, y: face.y + o.y * face.w })
    }

    if (!f.palm) {
      const gone = f.t - this.lastPalmAt
      if (this.armed && this.last && gone <= HOLD_MS && !f.holdStill) return this.last
      if (this.armed && gone > LOST_MS) this.disarm()
      if (!this.armed || !this.last) return idle(live)
      this.moving = false
      return { ...this.last, move: { x: 0, y: 0 }, moving: false, sector: -1 }
    }
    this.lastPalmAt = f.t

    if (!this.armed) {
      if (Math.hypot(f.palm.x - live.x, f.palm.y - live.y) / face.w >= p.dead) return idle(live)
      this.armed = true
      this.frozen = { c: live, w: face.w }
    }

    const { c, w } = this.frozen!
    const dx = (f.palm.x - c.x) / w
    let dy = -(f.palm.y - c.y) / w
    if (dy < 0) dy *= p.downGain
    const d = Math.hypot(dx, dy)
    this.moving = this.moving ? d > p.dead - HYSTERESIS : d > p.dead

    let move = { x: 0, y: 0 }
    let sector: PalmState['sector'] = -1
    if (this.moving) {
      // Сектор — для подсветки в мини-окне; к осям мира ходьбу притягивает уже сам герой (walk.ts).
      const axis = Math.round(Math.atan2(dy, dx) / (Math.PI / 2))
      sector = (((axis % 4) + 4) % 4) as 0 | 1 | 2 | 3
      const k = Math.min(1, Math.max(0, (d - p.dead) / (p.full - p.dead)))
      const m = p.minSpeed + (1 - p.minSpeed) * k
      move = { x: (dx / d) * m, y: (dy / d) * m }
    }
    this.last = { move, armed: true, moving: this.moving, center: c, dead: p.dead * w, full: p.full * w, faceAnchored: false, sector }
    return f.holdStill ? { ...this.last, move: { x: 0, y: 0 }, sector: -1 } : this.last
  }

  /** «Здесь удобно держать ладонь» — запомнить место кольца относительно лица. */
  calibrate(palm: Vec2, face: FaceAnchor) {
    const o = this.offsetFor(palm, face)
    this.params.offsetX = o.x
    this.params.offsetY = o.y
    this.face = face
    this.disarm()
  }

  /** «Круг больше / меньше» из меню: центр и полная скорость меняются вместе, но круг не исчезает и не раздувается. */
  resize(factor: number) {
    const p = this.params
    p.dead = clamp(p.dead * factor, DEAD_LIMITS)
    p.full = clamp(p.full * factor, [p.dead + RING_MIN, FULL_MAX])
  }

  /** Настройки, сохранённые в браузере (место и размер круга): чужие и испорченные значения не принимаем. */
  restore(saved: Record<string, unknown>) {
    const num = (k: string) => {
      const v = saved[k]
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined
    }
    const p = this.params
    const ox = num('offsetX')
    const oy = num('offsetY')
    const dead = num('dead')
    if (ox !== undefined) p.offsetX = clamp(ox, OFFSET_X)
    if (oy !== undefined) p.offsetY = clamp(oy, OFFSET_Y)
    if (dead !== undefined) p.dead = clamp(dead, DEAD_LIMITS)
    p.full = clamp(num('full') ?? p.full, [p.dead + RING_MIN, FULL_MAX])
  }

  /** Размер круга относительно обычного: 1 — как по умолчанию. */
  get ringScale() {
    return this.params.dead / PALM_DEFAULTS.dead
  }

  reset() {
    this.disarm()
    this.lastPalmAt = -Infinity
  }

  private offsetFor(palm: Vec2, face: FaceAnchor): Vec2 {
    return { x: clamp((palm.x - face.x) / face.w, OFFSET_X), y: clamp((palm.y - face.y) / face.w, OFFSET_Y) }
  }

  private disarm() {
    this.armed = false
    this.moving = false
    this.frozen = null
    this.last = null
  }
}
