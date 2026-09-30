import { describe, expect, it } from 'vitest'
import { capStep, EDGE_PROBE, snapToAxes, softEdges, type GroundAt } from './walk'

/** Остров 8×8 в центре и мост шириной 1.8 от его правого края (x 4..9, z −0.9..0.9) — как «Поверни мир». */
const islandAndBridge: GroundAt = (x, z) =>
  (Math.abs(x) <= 4 && Math.abs(z) <= 4) || (x >= 4 && x <= 9 && Math.abs(z) <= 0.9)

/** Идём с желаемой скоростью want 3 секунды (60 кадров в секунду); вернуть, где оказались. */
function walk(from: { x: number; z: number }, want: { x: number; z: number }, ground = islandAndBridge) {
  const pos = { ...from }
  for (let i = 0; i < 180; i++) {
    const v = softEdges(pos, want, ground)
    pos.x += v.x / 60
    pos.z += v.z / 60
  }
  return pos
}

describe('мягкие края', () => {
  it('к мосту не по центру — съезжает на мост и идёт по нему, а не упирается в край', () => {
    // Мост кончается на z = 0.9, а герой идёт по z = 1.2 — чуть мимо.
    const end = walk({ x: 0, z: 1.2 }, { x: 5, z: 0 })
    expect(end.x).toBeGreaterThan(6)
    expect(Math.abs(end.z)).toBeLessThan(0.9)
  })

  it('к обрыву, где моста рядом нет, — останавливается у края', () => {
    const end = walk({ x: 0, z: 3 }, { x: 5, z: 0 })
    expect(end.x).toBeLessThan(4)
    expect(end.z).toBeCloseTo(3)
  })

  it('с моста вбок в пропасть не шагнуть', () => {
    const end = walk({ x: 6, z: 0 }, { x: 0, z: 5 })
    expect(end.z).toBeLessThan(0.9)
  })

  it('по диагонали в край — скользит вдоль края, как раньше', () => {
    const end = walk({ x: 3, z: -2 }, { x: 5, z: 5 }, (x, z) => Math.abs(x) <= 4 && Math.abs(z) <= 4)
    expect(end.x).toBeLessThan(4)
    expect(end.z).toBeGreaterThan(2)
  })
})

describe('подтормаживание кадра', () => {
  it('кадр завис на полсекунды — за шаг физики герой не проскакивает мимо проверки края', () => {
    // Физика шагает на время кадра (до 0.5 с): на полной скорости это 2.6 м — сквозь мягкий край.
    const v = capStep(5.2, 0, 0.5)
    expect(Math.hypot(v.x, v.z) * 0.5).toBeLessThan(EDGE_PROBE)
  })

  it('на обычных кадрах скорость не трогаем', () => {
    expect(capStep(5.2, 1, 1 / 60)).toEqual({ x: 5.2, z: 1 })
  })
})

describe('ходьба притягивается к осям мира', () => {
  const deg = Math.PI / 180

  it('почти вдоль оси — идёт ровно по оси (мосты и острова стоят по осям)', () => {
    const v = snapToAxes(Math.cos(12 * deg), Math.sin(12 * deg))
    expect(v.x).toBeCloseTo(1)
    expect(Math.abs(v.z)).toBe(0)
  })

  it('по диагонали — по диагонали', () => {
    const v = snapToAxes(Math.SQRT1_2, -Math.SQRT1_2)
    expect(v.x).toBeCloseTo(Math.SQRT1_2)
    expect(v.z).toBeCloseTo(-Math.SQRT1_2)
  })

  it('скорость не меняется', () => {
    const v = snapToAxes(0.3 * Math.cos(95 * deg), 0.3 * Math.sin(95 * deg))
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0.3)
    expect(v.z).toBeCloseTo(0.3)
  })
})
