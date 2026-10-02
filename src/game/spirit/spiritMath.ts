/**
 * Чистая логика духа Окна (без Three.js и React — проверяется тестами):
 * пружина полёта, расписание морганий, место «у плеча» героя, след из точек.
 */

export type V3 = { x: number; y: number; z: number }

/**
 * Пружина с критическим затуханием, точное решение за шаг dt: догоняет цель без колебаний
 * и без дрожи при любом dt. omega — «жёсткость» (1/с): больше — быстрее догоняет.
 * Меняет x и v на месте.
 */
export function springStep(x: V3, v: V3, target: V3, omega: number, dt: number) {
  const e = Math.exp(-omega * dt)
  for (const k of ['x', 'y', 'z'] as const) {
    const change = x[k] - target[k]
    const temp = (v[k] + omega * change) * dt
    v[k] = (v[k] - omega * temp) * e
    x[k] = target[k] + (change + temp) * e
  }
}

/**
 * Моргание: раз в 2–5 с, иногда дважды подряд (как живое). open() — открытость глаз 0..1.
 * rnd — генератор случайных чисел (в тестах — предсказуемый).
 */
export class Blinker {
  private next: number
  private start = -1
  private double = false

  constructor(private rnd: () => number = Math.random, now = 0) {
    this.next = now + this.interval()
  }

  static readonly CLOSE_S = 0.07
  static readonly OPEN_S = 0.11

  private interval() {
    return 2 + this.rnd() * 3
  }

  /** Открытость глаз в момент t (с), t только растёт. */
  open(t: number) {
    if (this.start < 0 && t >= this.next) {
      this.start = t
      this.double = this.rnd() < 0.15
    }
    if (this.start < 0) return 1
    const u = t - this.start
    const len = Blinker.CLOSE_S + Blinker.OPEN_S
    if (u < Blinker.CLOSE_S) return 1 - u / Blinker.CLOSE_S
    if (u < len) return (u - Blinker.CLOSE_S) / Blinker.OPEN_S
    if (this.double) {
      // Второе моргание сразу за первым.
      this.double = false
      this.start = t
      return 1
    }
    this.start = -1
    this.next = t + this.interval()
    return 1
  }
}

/**
 * Где висит дух в режиме «рядом»: у плеча героя — сбоку по экрану, чуть выше головы и ближе к камере,
 * чтобы не закрывать героя и не стоять на линии взгляда. yaw — поворот камеры вокруг мира.
 */
export const FOLLOW = { side: 1.35, up: 1.45, toward: 0.45 }

export function followPoint(hero: V3, yaw: number, side: number, out: V3) {
  out.x = hero.x + Math.cos(yaw) * FOLLOW.side * side + Math.sin(yaw) * FOLLOW.toward
  out.y = hero.y + FOLLOW.up
  out.z = hero.z - Math.sin(yaw) * FOLLOW.side * side + Math.cos(yaw) * FOLLOW.toward
  return out
}

/**
 * След: последние точки пути (кольцевой буфер). Новая точка — только если сдвинулись на minStep,
 * поэтому на месте след не копится. Возраст точек растёт, старые отпадают.
 */
export class TrailBuffer {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly age: Float32Array
  private head = 0
  count = 0

  constructor(readonly size: number) {
    this.x = new Float32Array(size)
    this.y = new Float32Array(size)
    this.z = new Float32Array(size)
    this.age = new Float32Array(size)
  }

  /** i = 0 — самая свежая точка. */
  index(i: number) {
    return (this.head - 1 - i + this.size * 2) % this.size
  }

  update(p: V3, dt: number, minStep: number, maxAge: number) {
    for (let i = 0; i < this.count; i++) this.age[this.index(i)] += dt
    while (this.count > 0 && this.age[this.index(this.count - 1)] > maxAge) this.count--
    if (this.count > 0) {
      const j = this.index(0)
      const d = Math.hypot(p.x - this.x[j], p.y - this.y[j], p.z - this.z[j])
      if (d < minStep) return
    }
    this.x[this.head] = p.x
    this.y[this.head] = p.y
    this.z[this.head] = p.z
    this.age[this.head] = 0
    this.head = (this.head + 1) % this.size
    this.count = Math.min(this.count + 1, this.size)
  }

  clear() {
    this.count = 0
  }
}
