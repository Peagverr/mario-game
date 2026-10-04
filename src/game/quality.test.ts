import { describe, expect, it } from 'vitest'
import { qualityBounds, qualityLevels, stepQuality } from './quality'

describe('ступени качества картинки', () => {
  it('обычный режим — родная чёткость экрана, но не выше 1.5', () => {
    expect(qualityLevels(1)[0].dpr).toBe(1)
    expect(qualityLevels(1.25)[0].dpr).toBe(1.25)
    expect(qualityLevels(2)[0].dpr).toBe(1.5)
    expect(qualityLevels(2)[0].msaa).toBe(4)
    expect(qualityLevels(2)[0].low).toBe(false)
  })

  it.each([1, 1.25, 1.5, 2, 3])('экран %s×: самый слабый режим не мыльнее 80% обычного и не ниже пикселя экрана', (d) => {
    const levels = qualityLevels(d)
    const worst = levels[levels.length - 1]
    expect(worst.dpr).toBeGreaterThanOrEqual(0.8 * levels[0].dpr - 1e-9)
    expect(worst.dpr).toBeGreaterThanOrEqual(Math.min(1, d))
  })

  it('сначала жертвуем сглаживанием и эффектами, чёткостью — в последнюю очередь', () => {
    const [high, mid, low] = qualityLevels(1.5)
    expect(mid).toEqual({ dpr: high.dpr, msaa: 0, low: true })
    expect(low.dpr).toBeCloseTo(1.2)
    expect(low.dpr).toBeLessThan(high.dpr)
  })

  it('на обычном экране (1×) одинаковых ступеней нет — чёткость там и так не снижается', () => {
    const levels = qualityLevels(1)
    expect(levels).toHaveLength(2)
    expect(levels.every((q) => q.dpr === 1)).toBe(true)
  })

  it('кадров мало — на ступень вниз, хватает — обратно вверх; за края не выходим', () => {
    const n = qualityLevels(1.5).length
    expect(stepQuality(0, 'down', n)).toBe(1)
    expect(stepQuality(n - 1, 'down', n)).toBe(n - 1)
    expect(stepQuality(n - 1, 'up', n)).toBe(n - 2)
    expect(stepQuality(1, 'up', n)).toBe(0)
    expect(stepQuality(0, 'up', n)).toBe(0)
  })

  it('пороги не зависят от частоты экрана: на 144 Гц качество не режется при 55 к/с', () => {
    expect(qualityBounds(60)).toEqual(qualityBounds(144))
    const [down, up] = qualityBounds(144)
    expect(down).toBeLessThan(55)
    expect(down).toBeGreaterThanOrEqual(25)
    expect(up).toBeLessThanOrEqual(60)
    expect(up).toBeGreaterThan(down)
  })
})
