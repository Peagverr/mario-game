import { describe, expect, it } from 'vitest'
import { framesPerRender, isTrackingSlow, refreshRate, SLOW_INFER_MS, SLOW_WINDOW } from './pacing'

describe('облегчённый режим для слабой видеокарты', () => {
  it('на обычном экране рисуем каждый кадр, на быстром — около 72 к/с', () => {
    expect(framesPerRender(60)).toBe(1)
    expect(framesPerRender(75)).toBe(1)
    expect(framesPerRender(100)).toBe(1)
    expect(framesPerRender(120)).toBe(2)
    expect(framesPerRender(144)).toBe(2)
    expect(framesPerRender(165)).toBe(2)
    expect(framesPerRender(240)).toBe(3)
  })

  it('частота экрана неизвестна — рисуем каждый кадр', () => {
    expect(framesPerRender(0)).toBe(1)
    expect(framesPerRender(NaN)).toBe(1)
  })

  it('частота экрана — по медиане: кадры, задержанные нейросетью, её не сбивают', () => {
    const at144 = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 41.7 : 6.94))
    expect(refreshRate(at144)).toBeCloseTo(144, 0)
    expect(refreshRate([16.7, 16.7])).toBe(0)
  })

  it('медленно — только если почти все последние замеры дольше порога', () => {
    const slow = Array(SLOW_WINDOW).fill(SLOW_INFER_MS + 10)
    expect(isTrackingSlow(slow)).toBe(true)
    expect(isTrackingSlow(slow.slice(1))).toBe(false)
    const fast = Array(SLOW_WINDOW).fill(8.5)
    expect(isTrackingSlow(fast)).toBe(false)
    // Пара медленных замеров (загрузка уровня) режим не включает.
    expect(isTrackingSlow([...fast.slice(2), 40, 40])).toBe(false)
  })
})
