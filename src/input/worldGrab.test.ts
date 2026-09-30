import { describe, expect, it } from 'vitest'
import { WorldGrab, type View } from './worldGrab'

/** Кадр 4:3; точка щипка — в долях ширины и высоты кадра, размер ладони — в долях высоты. */
const ASPECT = 4 / 3
const VIEW: View = { yaw: 0, pitch: 0, zoom: 1 }
const P0 = { x: 0.3, y: 0.4, size: 0.2 }

function grab(view = VIEW) {
  const g = new WorldGrab()
  g.start(P0, view, ASPECT)
  return g
}

/**
 * Рука едет прямо к камере или от неё: ладонь на картинке растёт в ratio раз,
 * а точка щипка уезжает от центра кадра в те же ratio раз (перспектива).
 */
const toCamera = (ratio: number, p = P0) => ({ x: 0.5 + (p.x - 0.5) * ratio, y: 0.5 + (p.y - 0.5) * ratio, size: p.size * ratio })

/** Плавно, кадр за кадром, довести руку до ratio. */
function pushTo(g: WorldGrab, ratio: number) {
  let v = g.move(P0)
  for (let i = 1; i <= 10; i++) v = g.move(toCamera(1 + ((ratio - 1) * i) / 10))
  return v
}

describe('щипок левой: поворот, наклон, приближение', () => {
  it('тянешь вниз — мир наклоняется, а лёгкий уход вбок крутит совсем чуть-чуть', () => {
    const g = grab()
    g.move({ ...P0, x: P0.x + 0.005, y: P0.y + 0.05 })
    const v = g.move({ ...P0, x: P0.x + 0.01, y: P0.y + 0.1 })
    // Сдвиг на десятую часть кадра — уже заметный наклон.
    expect(v.pitch).toBeGreaterThan(0.2)
    expect(Math.abs(v.yaw)).toBeLessThan(0.06)
  })

  it('ведёшь в сторону — мир крутится, а лёгкий уход вверх-вниз наклоняет совсем чуть-чуть', () => {
    const g = grab()
    const v = g.move({ ...P0, x: P0.x + 0.15, y: P0.y + 0.02 })
    expect(v.yaw).toBeGreaterThan(0.3)
    expect(Math.abs(v.pitch)).toBeLessThan(0.07)
  })

  it('в одном щипке сначала вбок, потом вниз — меняются обе оси (нет «замка» на одну)', () => {
    const g = grab()
    const turned = g.move({ ...P0, x: P0.x + 0.12 })
    expect(turned.yaw).toBeGreaterThan(0.3)
    const both = g.move({ ...P0, x: P0.x + 0.12, y: P0.y + 0.1 })
    expect(both.yaw).toBeCloseTo(turned.yaw)
    expect(both.pitch).toBeGreaterThan(0.2)
  })

  it('по диагонали — и крутится, и наклоняется', () => {
    const g = grab()
    const v = g.move({ ...P0, x: P0.x + 0.06 / ASPECT, y: P0.y + 0.06 })
    expect(v.yaw).toBeGreaterThan(0)
    expect(v.pitch).toBeGreaterThan(0)
  })

  it('наклон упирается в предел: дальше тянуть бесполезно', () => {
    const far = grab().move({ ...P0, y: P0.y + 0.4 })
    const further = grab().move({ ...P0, y: P0.y + 0.55 })
    expect(far.pitch).toBeGreaterThan(0)
    expect(further.pitch).toBeCloseTo(far.pitch)
  })

  it('ладонь чуть «дышит» по размеру — мир не приближается; поднёс руку к камере — приближается', () => {
    const g = grab()
    expect(g.move({ ...P0, size: 0.206 }).zoom).toBe(1)
    expect(g.move({ ...P0, size: 0.3 }).zoom).toBeGreaterThan(1.2)
  })

  it('рука к камере на 10 см — заметно приближает, от камеры на 10 см — заметно отдаляет', () => {
    // Рука в 50 см от камеры: 10 см ближе — ладонь больше в 50/40 раз, 10 см дальше — в 50/60.
    expect(pushTo(grab(), 50 / 40).zoom).toBeGreaterThan(1.5)
    expect(pushTo(grab(), 50 / 60).zoom).toBeLessThan(0.75)
  })

  it('приближаешь — мир не крутится и не наклоняется, хотя точка щипка на картинке сдвигается', () => {
    const v = pushTo(grab(), 50 / 40)
    expect(Math.abs(v.yaw)).toBeLessThan(1e-6)
    expect(Math.abs(v.pitch)).toBeLessThan(1e-6)
    expect(v.zoom).toBeGreaterThan(1.5)
  })

  it('рука идёт прямо на объектив (точка щипка стоит на месте) — тоже чистый зум', () => {
    const g = grab()
    let v = g.move(P0)
    for (let i = 1; i <= 10; i++) v = g.move({ ...P0, size: P0.size * (1 + 0.025 * i) })
    expect(v.zoom).toBeGreaterThan(1.5)
    expect(Math.abs(v.yaw)).toBeLessThan(1e-6)
    expect(Math.abs(v.pitch)).toBeLessThan(1e-6)
  })

  it('крутишь мир — зум не меняется, даже если рука по дуге подъезжает к камере', () => {
    const g = grab()
    g.move({ ...P0, x: P0.x + 0.05 })
    const v = g.move({ ...P0, x: P0.x + 0.15, size: P0.size * 1.15 })
    expect(v.yaw).toBeGreaterThan(0.3)
    expect(v.zoom).toBe(1)
  })

  it('отпустил и щипнул заново — продолжаешь с того же вида', () => {
    const g = grab()
    const turned = g.move({ ...P0, x: P0.x + 0.15 })
    expect(turned.yaw).toBeGreaterThan(0)
    g.start(P0, turned, ASPECT)
    const tilted = g.move({ ...P0, y: P0.y + 0.1 })
    expect(tilted.yaw).toBeCloseTo(turned.yaw)
    expect(tilted.pitch).toBeGreaterThan(0.2)
  })
})
