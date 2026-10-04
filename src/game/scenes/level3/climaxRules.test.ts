import { describe, expect, it } from 'vitest'
import { CLIMAX_S, climaxProgress, climaxStart, climaxStep, type ClimaxEvent, type ClimaxInput } from './climaxRules'

const on = (o: Partial<ClimaxInput>): ClimaxInput => ({ playing: true, onIsland: false, onBridge: false, onSafe: false, ...o })

/** Прогнать секунды с шагом 1/60, собрать события. */
function run(s: ReturnType<typeof climaxStart>, seconds: number, input: ClimaxInput) {
  const events: ClimaxEvent[] = []
  for (let k = 0; k < Math.round(seconds * 60); k++) {
    const e = climaxStep(s, input, 1 / 60)
    if (e) events.push(e)
  }
  return events
}

describe('кульминация «остров рушится»', () => {
  it('начинается, когда герой ступил на остров, а не раньше', () => {
    const s = climaxStart()
    expect(run(s, 5, on({}))).toEqual([])
    expect(run(s, 0.1, on({ onIsland: true }))).toEqual(['start'])
    expect(s.phase).toBe('running')
  })

  it('добежал до последнего острова вовремя — «успел», больше ничего не происходит', () => {
    const s = climaxStart()
    run(s, 10, on({ onIsland: true }))
    run(s, 2, on({ onBridge: true }))
    expect(run(s, 0.1, on({ onSafe: true }))).toEqual(['escape'])
    expect(run(s, 30, on({ onSafe: true }))).toEqual([])
    expect(climaxProgress(s)).toBe(1)
  })

  it('время вышло, а герой на острове — «не успел», отсчёт заново', () => {
    const s = climaxStart()
    const ev = run(s, CLIMAX_S + 1, on({ onIsland: true }))
    expect(ev).toEqual(['start', 'fail'])
    expect(s.left).toBeGreaterThan(CLIMAX_S - 1.5)
  })

  it('время вышло, когда герой уже на мосту, — не наказываем, пусть добежит', () => {
    const s = climaxStart()
    run(s, CLIMAX_S - 1, on({ onIsland: true }))
    expect(run(s, 5, on({ onBridge: true }))).toEqual([])
    expect(run(s, 0.1, on({ onSafe: true }))).toEqual(['escape'])
  })

  it('ушёл назад, на прошлый остров, — отсчёт стоит', () => {
    const s = climaxStart()
    run(s, 5, on({ onIsland: true }))
    const left = s.left
    run(s, 60, on({}))
    expect(s.left).toBeCloseTo(left)
  })

  it('на паузе отсчёт стоит', () => {
    const s = climaxStart()
    run(s, 5, on({ onIsland: true }))
    const left = s.left
    run(s, 60, on({ onIsland: true, playing: false }))
    expect(s.left).toBeCloseTo(left)
  })
})
