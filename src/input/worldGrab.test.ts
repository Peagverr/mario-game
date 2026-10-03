import { describe, expect, it } from 'vitest'
import { EDGE_M, handScale, WorldGrab, type GrabPoint, type View } from './worldGrab'

/** Кадр 4:3, 30 кадров в секунду. Рука в полуметре: метр там — 2.5 высоты кадра. */
const ASPECT = 4 / 3
const FPS_MS = 33
const S = 2.5
const VIEW: View = { yaw: 0, pitch: 0, zoom: 1 }
const P0: GrabPoint = { x: 0.3, y: 0.45, scale: S }

/** Рука сдвинулась на (mx, my) метров вправо и вниз от P0, масштаб умножен на grow. */
const at = (mx: number, my: number, grow = 1): GrabPoint => ({ x: P0.x + (mx * S) / ASPECT, y: P0.y + my * S, scale: S * grow })

/**
 * Рука идёт к камере: на картинке растёт в ratio раз, а точка хвата уезжает от центра кадра в те же ratio раз.
 */
const toCamera = (ratio: number, from = P0): GrabPoint => ({
  x: 0.5 + (from.x - 0.5) * ratio,
  y: 0.5 + (from.y - 0.5) * ratio,
  scale: from.scale * ratio,
})

/** Хват: сжал кулак в момент 0, дальше кадры path(доля 0..1) за ms миллисекунд. */
class Hand {
  g = new WorldGrab()
  t = 0
  v: View
  constructor(view = VIEW, p = P0) {
    this.g.start(p, view, ASPECT, 0)
    this.v = { ...view }
  }
  /** Плавно провести руку: path(k) — точка при доле пути k (0..1), за ms. */
  go(ms: number, path: (k: number) => GrabPoint) {
    const n = Math.max(1, Math.round(ms / FPS_MS))
    for (let i = 1; i <= n; i++) {
      this.t += FPS_MS
      this.v = this.g.move(path(i / n), this.t)
    }
    return this.v
  }
  /** Держать руку на месте. */
  hold(ms: number, p: GrabPoint) {
    return this.go(ms, () => p)
  }
}

describe('левый кулак: рядом мир едет за рукой', () => {
  it('ведёшь в сторону — мир крутится, вверх-вниз почти не наклоняется', () => {
    const h = new Hand()
    h.hold(200, P0)
    const v = h.go(300, (k) => at(0.08 * k, 0.005 * k))
    expect(v.yaw).toBeGreaterThan(0.5)
    expect(Math.abs(v.pitch)).toBeLessThan(0.05)
    expect(v.zoom).toBe(1)
  })

  it('тянешь вниз — мир наклоняется, почти не крутится', () => {
    const h = new Hand()
    const v = h.go(300, (k) => at(0.005 * k, 0.07 * k))
    expect(v.pitch).toBeGreaterThan(0.35)
    expect(Math.abs(v.yaw)).toBeLessThan(0.06)
  })

  it('по диагонали вправо-вниз — и крутится, и наклоняется', () => {
    const h = new Hand()
    const v = h.go(400, (k) => at(0.06 * k, 0.06 * k))
    expect(v.yaw).toBeGreaterThan(0.4)
    expect(v.pitch).toBeGreaterThan(0.3)
    expect(v.zoom).toBe(1)
  })

  it('по диагонали, а рука на картинке «растёт» от поворота кисти (баг со скрина) — НЕ зум, мир крутится и наклоняется', () => {
    const h = new Hand()
    const v = h.go(500, (k) => at(0.06 * k, 0.06 * k, 1 + 0.12 * k + 0.03 * Math.sin(k * 40)))
    expect(v.zoom).toBe(1)
    expect(v.yaw).toBeGreaterThan(0.4)
    expect(v.pitch).toBeGreaterThan(0.3)
  })

  it('пока кулак сжимается, рука «плывёт» на 9% — это не зум', () => {
    const h = new Hand()
    h.go(100, (k) => at(0, 0, 1 + 0.09 * k))
    h.hold(150, at(0, 0, 1.09))
    const v = h.go(400, (k) => at(0.06 * k, 0.06 * k, 1.09))
    expect(v.zoom).toBe(1)
    expect(v.yaw).toBeGreaterThan(0.4)
  })

  it('сжал и сразу повёл по диагонали, кулак при этом подался к камере на 10% — мир крутится и наклоняется', () => {
    const h = new Hand()
    const v = h.go(500, (k) => at(0.06 * k, 0.06 * k, 1 + Math.min(0.1, k)))
    expect(v.yaw).toBeGreaterThan(0.4)
    expect(v.pitch).toBeGreaterThan(0.3)
    expect(v.zoom).toBe(1)
  })

  it('ладонь чуть «дышит» в покое — мир стоит', () => {
    const h = new Hand()
    const v = h.go(1500, (k) => at(0.002 * Math.sin(k * 50), 0.002 * Math.cos(k * 37), 1 + 0.03 * Math.sin(k * 60)))
    expect(v.zoom).toBe(1)
    expect(Math.abs(v.yaw)).toBeLessThan(0.03)
    expect(Math.abs(v.pitch)).toBeLessThan(0.03)
  })

  it('наклон упирается в предел', () => {
    const v = new Hand().go(1500, (k) => at(0, 0.3 * k))
    expect(v.pitch).toBeCloseTo(0.55)
  })
})

describe('левый кулак: за краем зоны мир докручивается сам', () => {
  it('увёл руку на 15 см и держишь — мир продолжает крутиться; вернул ближе — перестал', () => {
    const h = new Hand()
    const moved = h.go(300, (k) => at(0.15 * k, 0))
    const held = h.hold(1000, at(0.15, 0))
    expect(held.yaw - moved.yaw).toBeGreaterThan(0.8)
    const back = h.go(300, (k) => at(0.15 - 0.1 * k, 0))
    const still = h.hold(500, at(0.05, 0))
    expect(Math.abs(still.yaw - back.yaw)).toBeLessThan(1e-9)
  })

  it('внутри зоны мир сам не крутится', () => {
    const h = new Hand()
    const moved = h.go(300, (k) => at(EDGE_M * 0.9 * k, 0))
    const held = h.hold(1000, at(EDGE_M * 0.9, 0))
    expect(held.yaw).toBeCloseTo(moved.yaw)
  })

  it('по диагонали за краем — докручиваются обе оси', () => {
    const h = new Hand()
    const moved = h.go(300, (k) => at(-0.12 * k, -0.04 * k))
    const held = h.hold(500, at(-0.12, -0.04))
    expect(held.yaw).toBeLessThan(moved.yaw - 0.3)
    expect(held.pitch).toBeLessThan(moved.pitch)
  })
})

describe('левый кулак: к камере — зум', () => {
  it('рука к камере на 10 см — заметно приближает и не крутит мир; от камеры — отдаляет', () => {
    const h = new Hand()
    h.hold(200, P0)
    h.go(400, (k) => toCamera(1 + (50 / 40 - 1) * k))
    const v = h.hold(300, toCamera(50 / 40))
    expect(v.zoom).toBeGreaterThan(1.5)
    expect(Math.abs(v.yaw)).toBeLessThan(0.05)
    expect(Math.abs(v.pitch)).toBeLessThan(0.05)

    const far = new Hand()
    far.hold(200, P0)
    far.go(400, (k) => toCamera(1 + (50 / 60 - 1) * k))
    expect(far.hold(300, toCamera(50 / 60)).zoom).toBeLessThan(0.75)
  })

  it('медленно, за полторы секунды, к камере — тоже зум', () => {
    const h = new Hand()
    h.hold(200, P0)
    expect(h.go(1500, (k) => toCamera(1 + (50 / 40 - 1) * k)).zoom).toBeGreaterThan(1.4)
  })

  it('рука идёт прямо на объектив (точка стоит на месте) — тоже чистый зум', () => {
    const h = new Hand()
    h.hold(200, P0)
    h.go(400, (k) => at(0, 0, 1 + 0.25 * k))
    const v = h.hold(300, at(0, 0, 1.25))
    expect(v.zoom).toBeGreaterThan(1.5)
    expect(Math.abs(v.yaw)).toBeLessThan(1e-6)
  })

  it('приблизил и, не разжимая кулак, повёл вбок — зум остался, мир крутится', () => {
    const h = new Hand()
    h.hold(200, P0)
    h.go(400, (k) => toCamera(1 + 0.25 * k))
    const zoomed = h.hold(300, toCamera(1.25))
    expect(zoomed.zoom).toBeGreaterThan(1.5)
    const near = toCamera(1.25)
    const v = h.go(400, (k) => ({ ...near, x: near.x + (0.1 * k * near.scale) / ASPECT }))
    expect(v.zoom).toBeCloseTo(zoomed.zoom, 1)
    expect(v.yaw).toBeGreaterThan(0.3)
  })

  it('крутишь мир, а рука по дуге подъезжает к камере — зум не меняется', () => {
    const h = new Hand()
    const v = h.go(500, (k) => at(0.15 * k, 0, 1 + 0.15 * k))
    expect(v.yaw).toBeGreaterThan(0.6)
    expect(v.zoom).toBe(1)
  })
})

describe('левый кулак: разное', () => {
  it('отпустил и сжал заново — продолжаешь с того же вида', () => {
    const turned = new Hand().go(300, (k) => at(0.06 * k, 0))
    const v = new Hand(turned).go(300, (k) => at(0, 0.05 * k))
    expect(v.yaw).toBeCloseTo(turned.yaw)
    expect(v.pitch).toBeGreaterThan(0.2)
  })

  it('«быстрее» в меню — тот же ход руки крутит сильнее', () => {
    const slow = new Hand().go(300, (k) => at(0.06 * k, 0))
    const fast = new Hand()
    fast.g.speed = 1.5
    expect(fast.go(300, (k) => at(0.06 * k, 0)).yaw).toBeCloseTo(slow.yaw * 1.5)
  })
})

describe('масштаб руки на картинке', () => {
  // Ладонь в метрах: запястье и основания пальцев (y вверх — минус, как в MediaPipe).
  const WORLD = [
    { x: 0, y: 0, z: 0 },
    ...Array.from({ length: 4 }, () => ({ x: -0.02, y: -0.03, z: 0 })),
    { x: -0.035, y: -0.08, z: 0 },
    ...Array.from({ length: 3 }, () => ({ x: -0.035, y: -0.12, z: 0 })),
    { x: -0.01, y: -0.085, z: 0 },
    ...Array.from({ length: 3 }, () => ({ x: -0.01, y: -0.13, z: 0 })),
    { x: 0.012, y: -0.08, z: 0 },
    ...Array.from({ length: 3 }, () => ({ x: 0.012, y: -0.12, z: 0 })),
    { x: 0.033, y: -0.07, z: 0 },
    ...Array.from({ length: 3 }, () => ({ x: 0.033, y: -0.1, z: 0 })),
  ]
  /** Картинка руки: масштаб s (высот кадра на метр), кисть наклонена вперёд на tilt радиан (вдоль руки короче). */
  const image = (s: number, tilt = 0) =>
    WORLD.map((p) => ({ x: 0.3 + (p.x * s) / ASPECT, y: 0.5 + p.y * Math.cos(tilt) * s, z: 0 }))

  it('кисть наклонилась на 50° — масштаб почти тот же (а одна кость на картинке укоротилась бы на треть)', () => {
    const flat = handScale(image(S), WORLD, ASPECT)
    const tilted = handScale(image(S, (50 * Math.PI) / 180), WORLD, ASPECT)
    expect(flat).toBeCloseTo(S, 1)
    expect(Math.abs(tilted / flat - 1)).toBeLessThan(0.05)
  })

  it('рука ближе к камере — масштаб растёт во столько же раз', () => {
    expect(handScale(image(S * 1.25), WORLD, ASPECT) / handScale(image(S), WORLD, ASPECT)).toBeCloseTo(1.25, 2)
  })

  it('нет объёмных точек — по одной кости и типичной ладони', () => {
    const s = handScale(image(S), undefined, ASPECT)
    expect(s).toBeGreaterThan(S * 0.8)
    expect(s).toBeLessThan(S * 1.3)
  })
})
