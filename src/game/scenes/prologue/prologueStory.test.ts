import { describe, expect, it } from 'vitest'
import { RESULTS_TIME, SCENE_TIME } from '../../atmosphere/atmosphere'
import { memoryVisibility, NIGHT_T, peekAmount, prologueTime } from './prologueStory'

describe('пролог «Первый свет»', () => {
  it('ночь светлеет с каждым фонарём и после воспоминания, но до рассвета не доходит (рассвет — финал)', () => {
    expect(prologueTime(0, false)).toBe(NIGHT_T)
    expect(prologueTime(0, false)).toBeLessThanOrEqual(SCENE_TIME.lobby)
    for (let i = 1; i <= 7; i++) expect(prologueTime(i, false)).toBeGreaterThan(prologueTime(i - 1, false))
    expect(prologueTime(7, true)).toBeGreaterThan(prologueTime(7, false))
    expect(prologueTime(7, true)).toBeLessThan(RESULTS_TIME * 0.5)
  })

  it('воспоминание: далеко — не видно, рядом — едва, заглянул головой — целиком', () => {
    expect(memoryVisibility(0, 1)).toBe(0)
    expect(memoryVisibility(1, 0)).toBeCloseTo(0.3)
    expect(memoryVisibility(1, 1)).toBe(1)
  })

  it('«заглянул»: мелкое покачивание головы не считается, явный сдвиг на 5 см — полностью', () => {
    expect(peekAmount(0.005)).toBe(0)
    expect(peekAmount(-0.05)).toBe(1)
    expect(peekAmount(0.03)).toBeGreaterThan(0.3)
    expect(peekAmount(0.03)).toBeLessThan(0.7)
  })
})
