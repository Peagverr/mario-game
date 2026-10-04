import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSeconds, useGame } from './gameStore'

/** Часы под нашим управлением: performance.now() возвращает now. */
let now = 0
beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  useGame.setState({ phase: 'start', pauseReason: 'menu', pausedAt: 0, startedAt: 0, finishedAt: 0 })
})
afterEach(() => vi.restoreAllMocks())

const g = () => useGame.getState()

describe('таймер уровня и пауза', () => {
  it('на паузе через меню таймер стоит: 10 с игры + 30 с меню + 5 с игры = 15 с', () => {
    g().startRun()
    now += 10_000
    g().pause('menu')
    now += 30_000
    expect(runSeconds(g())).toBeGreaterThan(10) // на самой паузе экран времени не показывает
    g().setPhase('playing')
    now += 5_000
    expect(runSeconds(g())).toBeCloseTo(15)
    g().finishRun()
    now += 60_000
    expect(runSeconds(g())).toBeCloseTo(15)
  })

  it('пропала камера — таймер стоит, с причиной «камера»', () => {
    g().startRun()
    now += 4_000
    g().pause('camera')
    expect(g().pauseReason).toBe('camera')
    now += 20_000
    g().setPhase('playing')
    now += 1_000
    expect(runSeconds(g())).toBeCloseTo(5)
  })

  it('две паузы подряд складываются', () => {
    g().startRun()
    now += 2_000
    g().pause('menu')
    now += 7_000
    g().setPhase('playing')
    now += 3_000
    g().pause('camera')
    now += 11_000
    g().setPhase('playing')
    now += 1_000
    expect(runSeconds(g())).toBeCloseTo(6)
  })

  it('«Заново» с паузы — новый забег, старая пауза не тянется', () => {
    useGame.setState({ sceneId: 'level1' })
    g().startRun()
    now += 2_000
    g().pause('menu')
    now += 5_000
    g().restart()
    expect(g().pausedAt).toBe(0)
    expect(g().phase).toBe('countdown')
    g().startRun()
    now += 3_000
    expect(runSeconds(g())).toBeCloseTo(3)
  })

  it('в лобби таймера нет — выход из паузы ничего не ломает', () => {
    useGame.setState({ sceneId: 'lobby', phase: 'playing', startedAt: 0 })
    g().pause('menu')
    now += 5_000
    g().setPhase('playing')
    expect(g().startedAt).toBe(0)
    expect(runSeconds(g())).toBe(0)
  })
})

describe('пройденные уровни (сюжет: свет духа и прощание)', () => {
  it('финиш уровня запоминает его один раз; «Заново» и переход в лобби не стирают', () => {
    useGame.setState({ completed: [], sceneId: 'level1' })
    g().startRun()
    g().finishRun()
    g().restart()
    g().startRun()
    g().finishRun()
    expect(g().completed).toEqual(['level1'])
    g().goToScene('level3')
    g().startRun()
    g().finishRun()
    g().goToScene('lobby')
    expect(g().completed).toEqual(['level1', 'level3'])
  })
})
