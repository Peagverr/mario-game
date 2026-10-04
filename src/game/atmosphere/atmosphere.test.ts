import { describe, expect, it } from 'vitest'
import { approachTime, KEYS, lobbyTime, RESULTS_TIME, SCENE_TIME, sampleAtmo } from './atmosphere'

const brightness = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

describe('время суток', () => {
  it('ночь (лобби) тёмная и звёздная, рассвет (итоги) светлый и без звёзд', () => {
    const night = sampleAtmo(SCENE_TIME.lobby)
    const dawn = sampleAtmo(RESULTS_TIME)
    expect(night.stars).toBeGreaterThan(0.8)
    expect(dawn.stars).toBe(0)
    expect(brightness(night.skyTop)).toBeLessThan(brightness(dawn.skyTop) / 5)
    expect(night.keyIntensity).toBeLessThan(dawn.keyIntensity)
  })

  it('сцены идут от ночи к рассвету: солнце с каждой сценой выше, звёзд меньше', () => {
    const order = [SCENE_TIME.lobby, SCENE_TIME.level1, SCENE_TIME.level2, SCENE_TIME.level3, RESULTS_TIME]
    const sun = order.map((t) => sampleAtmo(t).sunDir.y)
    const stars = order.map((t) => sampleAtmo(t).stars)
    for (let i = 1; i < order.length; i++) {
      expect(sun[i]).toBeGreaterThan(sun[i - 1])
      expect(stars[i]).toBeLessThanOrEqual(stars[i - 1])
    }
    // Ночью солнце под горизонтом, на рассвете — над ним.
    expect(sun[0]).toBeLessThan(0)
    expect(sun.at(-1)!).toBeGreaterThan(0)
  })

  it('на ключевых точках — ровно значения из таблицы', () => {
    for (const k of KEYS) {
      const a = sampleAtmo(k.t)
      expect(a.stars).toBeCloseTo(k.stars)
      expect(a.fogFar).toBeCloseTo(k.fogFar)
    }
  })

  it('ключевой свет всегда сверху (острова не освещаются снизу), даже ночью', () => {
    for (let t = 0; t <= 1; t += 0.05) expect(sampleAtmo(t).keyDir.y).toBeGreaterThan(0.2)
  })

  it('смена сцены — плавный переход: за 1 с ещё не дошли, за 4 с почти целиком', () => {
    let t = 0.1
    for (let i = 0; i < 60; i++) t = approachTime(t, 0.35, 1 / 60)
    expect(t - 0.1).toBeGreaterThan(0.1)
    expect(t - 0.1).toBeLessThan(0.25 * 0.7)
    for (let i = 0; i < 180; i++) t = approachTime(t, 0.35, 1 / 60)
    expect(0.35 - t).toBeLessThan(0.01)
  })
})

describe('сюжет: лобби светлеет с каждым возвращённым осколком', () => {
  it('ночь → светлее с каждым пройденным уровнем → рассвет после трёх', () => {
    const t = [0, 1, 2, 3].map(lobbyTime)
    expect(t[0]).toBe(SCENE_TIME.lobby)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1])
    expect(t[3]).toBe(RESULTS_TIME)
    expect(lobbyTime(7)).toBe(RESULTS_TIME)
  })
})
