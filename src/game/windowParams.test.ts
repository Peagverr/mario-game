import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { adaptNeutral } from './windowParams'

/** Держать голову в положении head столько секунд (60 кадров в секунду); вернуть, сколько сдвига осталось по y. */
function hold(headY: number, seconds: number) {
  const neutral = new Vector3(0, 0, 0.6)
  const head = { x: 0, y: headY, z: 0.6 }
  for (let i = 0; i < seconds * 60; i++) adaptNeutral(neutral, head, 1 / 60)
  return (head.y - neutral.y) / headY
}

describe('обычное положение головы (эффект окна)', () => {
  it('заглядываешь через стену: голова на 6 см выше 3 секунды — эффект почти не уплывает', () => {
    expect(hold(0.06, 3)).toBeGreaterThan(0.94)
  })

  it('сел чуть иначе (1,5 см) — за 12 секунд подстраивается больше чем наполовину', () => {
    expect(hold(0.015, 12)).toBeLessThan(0.5)
  })

  it('сел совсем иначе (10 см) — всё равно подстраивается, пусть медленнее: за минуту больше чем наполовину', () => {
    expect(hold(0.1, 60)).toBeLessThan(0.5)
  })
})
