/**
 * Ладонь-джойстик: круг стоит в кадре камеры справа внизу (на экране — большой джойстик в правом нижнем углу).
 *
 * - Круг к лицу не привязан: голова двигается для эффекта окна — круг и герой на месте.
 *   Рука лежит низко справа (можно опереть локоть на стол) — не устаёт, как поднятая к лицу.
 * - Пока ладонь не побывала в центре круга, герой стоит: рука, поднятая снизу, не уводит его назад.
 * - Вышла из центра — идёт туда: вверх — вперёд, вниз — назад, в стороны — вбок
 *   (к осям мира ходьбу притягивает уже сам герой — walk.ts).
 *
 * Координаты «квадратные»: x·(ширина/высота кадра), y — доли высоты кадра, зеркально (как в мини-окне).
 * Место круга — в долях кадра, а размеры — в ширинах лица, поэтому они не зависят от того, как далеко сидишь.
 */

export type Vec2 = { x: number; y: number }
/** Лицо: центр между зрачками и ширина от скулы до скулы. */
export type FaceAnchor = { x: number; y: number; w: number }

export type PalmParams = {
  /** Центр круга в кадре: доли ширины и высоты кадра, зеркально (как в мини-окне). */
  anchorX: number
  anchorY: number
  /** Радиус центра («стоп») и радиус полной скорости, в ширинах лица. */
  dead: number
  full: number
  /** Вниз рука двигается хуже (мешают стол и локоть), поэтому вниз нужно меньшее движение. */
  downGain: number
  /** Скорость сразу за границей центра — доля полной. */
  minSpeed: number
}

export const PALM_DEFAULTS: PalmParams = { anchorX: 0.76, anchorY: 0.7, dead: 0.25, full: 0.55, downGain: 1.3, minSpeed: 0.45 }

/** Руки нет дольше — джойстик снова ждёт ладонь в центре. */
const LOST_MS = 400
/** Руку потеряли на пару кадров — держим последнее движение, чтобы герой не спотыкался. */
const HOLD_MS = 150
/** Запас на возврат в центр: на границе не мигает «иду — стою». */
const HYSTERESIS = 0.04
/**
 * «Поставить заново» не ставит круг на лицо, влево и к краю кадра: правая половина, ниже глаз.
 * Ниже 0.85 и правее 0.92 рука при ходьбе «назад» и «вправо» уходила бы за край кадра.
 */
const ANCHOR_X = [0.55, 0.92] as const
const ANCHOR_Y = [0.35, 0.85] as const
/** «Круг меньше / больше»: пределы центра, наименьший зазор до полной скорости и её дальний предел (в ширинах лица). */
const DEAD_LIMITS = [0.12, 0.45] as const
const RING_MIN = 0.15
const FULL_MAX = 1
/** Пока лицо ни разу не видели — считаем его обычной ширины (доли высоты кадра). */
const FALLBACK_FACE_W = 0.28

export type PalmFrame = {
  t: number
  /** Центр правой ладони или null, если руки не видно. */
  palm: Vec2 | null
  /** Лицо, если его видно сейчас (нужна только его ширина — размер круга). */
  face: FaceAnchor | null
  /** Ширина кадра / высота: место круга задано в долях кадра. */
  aspect: number
  /** Меню открыто или сейчас не игра — джойстик выключен, после — снова через центр. */
  suspended: boolean
  /** «Поставить круг заново»: кольцо под ладонью, герой стоит. */
  calibrating: boolean
  /** Две раскрытые ладони (меню открывается): стоим, но центр не сбрасываем — ладонь могла раскрыться перед хватом кулаком. */
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
  /**
   * Где ладонь относительно круга: 1 — край круга (полная скорость), y вверх; вниз — с тем же усилением, что ходьба.
   * Для большого джойстика на экране. null — ладони не видно.
   */
  stick: Vec2 | null
  /** Куда идём: 0 вправо, 1 вперёд, 2 влево, 3 назад, −1 — стоим. */
  sector: -1 | 0 | 1 | 2 | 3
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

export class PalmJoystick {
  params: PalmParams
  private armed = false
  private moving = false
  /** Пока джойстик взведён, размер круга заморожен: ширина лица на момент взвода. */
  private frozenW: number | null = null
  private faceW: number | null = null
  private lastPalmAt = -Infinity
  private last: PalmState | null = null

  constructor(params: PalmParams = PALM_DEFAULTS) {
    this.params = { ...params }
  }

  update(f: PalmFrame): PalmState {
    if (f.face) this.faceW = f.face.w
    const p = this.params
    const anchor = { x: p.anchorX * f.aspect, y: p.anchorY }
    const idle = (center: Vec2, w: number, palm: Vec2 | null): PalmState => ({
      move: { x: 0, y: 0 },
      armed: false,
      moving: false,
      center,
      dead: p.dead * w,
      full: p.full * w,
      stick: palm ? this.stick(palm, center, w) : null,
      sector: -1,
    })

    if (f.suspended || f.calibrating) {
      this.disarm()
      const w = this.faceW ?? FALLBACK_FACE_W
      if (!f.calibrating || !f.palm) return idle(anchor, w, null)
      // Калибровка: кольцо под ладонью, но не на лице и не за краем кадра.
      const a = this.anchorFor(f.palm, f.aspect)
      return idle({ x: a.x * f.aspect, y: a.y }, w, null)
    }

    if (!f.palm) {
      const gone = f.t - this.lastPalmAt
      if (this.armed && this.last && gone <= HOLD_MS && !f.holdStill) return this.last
      if (this.armed && gone > LOST_MS) this.disarm()
      if (!this.armed || !this.last) return idle(anchor, this.faceW ?? FALLBACK_FACE_W, null)
      this.moving = false
      return { ...this.last, move: { x: 0, y: 0 }, moving: false, stick: null, sector: -1 }
    }
    this.lastPalmAt = f.t

    if (!this.armed) {
      const w = this.faceW ?? FALLBACK_FACE_W
      if (Math.hypot(f.palm.x - anchor.x, f.palm.y - anchor.y) / w >= p.dead) return idle(anchor, w, f.palm)
      this.armed = true
      this.frozenW = w
    }

    const w = this.frozenW!
    const stick = this.stick(f.palm, anchor, w)
    const dx = stick.x * p.full
    const dy = stick.y * p.full
    const d = Math.hypot(dx, dy)
    this.moving = this.moving ? d > p.dead - HYSTERESIS : d > p.dead

    let move = { x: 0, y: 0 }
    let sector: PalmState['sector'] = -1
    if (this.moving) {
      // Сектор — для подсветки джойстика; к осям мира ходьбу притягивает уже сам герой (walk.ts).
      const axis = Math.round(Math.atan2(dy, dx) / (Math.PI / 2))
      sector = (((axis % 4) + 4) % 4) as 0 | 1 | 2 | 3
      const k = Math.min(1, Math.max(0, (d - p.dead) / (p.full - p.dead)))
      const m = p.minSpeed + (1 - p.minSpeed) * k
      move = { x: (dx / d) * m, y: (dy / d) * m }
    }
    this.last = { move, armed: true, moving: this.moving, center: anchor, dead: p.dead * w, full: p.full * w, stick, sector }
    return f.holdStill ? { ...this.last, move: { x: 0, y: 0 }, sector: -1 } : this.last
  }

  /** «Здесь удобно держать ладонь» — запомнить место круга в кадре. */
  calibrate(palm: Vec2, aspect: number) {
    const a = this.anchorFor(palm, aspect)
    this.params.anchorX = a.x
    this.params.anchorY = a.y
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
    const ax = num('anchorX')
    const ay = num('anchorY')
    const dead = num('dead')
    if (ax !== undefined) p.anchorX = clamp(ax, ANCHOR_X)
    if (ay !== undefined) p.anchorY = clamp(ay, ANCHOR_Y)
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

  /** Ладонь относительно центра круга: в радиусах полной скорости, y вверх, вниз — с усилением. */
  private stick(palm: Vec2, center: Vec2, w: number): Vec2 {
    const p = this.params
    const dx = (palm.x - center.x) / w
    let dy = -(palm.y - center.y) / w
    if (dy < 0) dy *= p.downGain
    return { x: dx / p.full, y: dy / p.full }
  }

  /** Место круга (доли кадра) под ладонью — в пределах разрешённой зоны. */
  private anchorFor(palm: Vec2, aspect: number): Vec2 {
    return { x: clamp(palm.x / aspect, ANCHOR_X), y: clamp(palm.y, ANCHOR_Y) }
  }

  private disarm() {
    this.armed = false
    this.moving = false
    this.frozenW = null
    this.last = null
  }
}
