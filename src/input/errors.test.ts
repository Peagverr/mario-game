import { describe, expect, it } from 'vitest'
import type { HandState, Hint, HintCode } from '../shared/controlState'
import { detectCandidates, HintFilter, type ErrorContext } from './errors'

/** Раскрытая правая ладонь посреди кадра — ни одна точка не у края. */
function openPalm(): HandState {
  const points = Array.from({ length: 21 }, (_, i) => ({ x: 0.68 + (i % 5) * 0.02, y: 0.45 + (i / 20) * 0.25, z: 0 }))
  return {
    present: true,
    points,
    size: 0.2,
    palm: { x: 0.72, y: 0.62, z: 0 },
    curls: ['extended', 'extended', 'extended', 'extended', 'extended'],
    fist: false,
    openPalm: true,
    pinchRatio: 1.2,
    pinching: false,
    pointing: false,
    pointDir: { x: 0, y: 1 },
    pointLen: 0.9,
    gesture: 'Open_Palm',
  }
}

const base: ErrorContext = {
  left: null,
  right: openPalm(),
  head: { z: 0.6, visible: true, yawDeg: 0 },
  brightness: 0.6,
  noHandsMs: 0,
  noFaceMs: 0,
  onlyLeftMs: 0,
  leftLostWhileGrabMs: 0,
  palmUnarmedMs: 0,
  wantsHands: true,
  inTutorial: false,
}
const codes = (c: Partial<ErrorContext>) => detectCandidates({ ...base, ...c }).map((h) => h.code)
const hint = (code: HintCode): Hint => ({ code, text: code })

describe('подсказка «заведи ладонь в круг»', () => {
  it('ладонь видна, но полторы секунды не заходила в круг — подсказываем', () => {
    expect(codes({ palmUnarmedMs: 1600 })).toContain('palm-not-armed')
  })

  it('не торопим: только что подняли руку', () => {
    expect(codes({ palmUnarmedMs: 400 })).not.toContain('palm-not-armed')
  })

  it('в меню и на экранах без игры не подсказываем', () => {
    expect(codes({ wantsHands: false, palmUnarmedMs: 1600 })).not.toContain('palm-not-armed')
  })
})

describe('левая рука', () => {
  it('левая рука пропала посреди хвата кулаком — подсказка держать кулак к камере', () => {
    const hints = detectCandidates({ ...base, leftLostWhileGrabMs: 600 })
    const h = hints.find((x) => x.code === 'hand-turned')
    expect(h?.text).toContain('кулак')
  })

  it('пальцы почти сомкнуты — подсказки «сведи плотнее» нет', () => {
    const left = { ...openPalm(), pinchRatio: 0.6, pinching: false, curls: ['half', 'half', 'extended', 'extended', 'extended'] as HandState['curls'] }
    expect(codes({ left })).toEqual([])
  })
})

describe('чёрный кадр', () => {
  it('камера показывает чёрный кадр — одна подсказка про камеру, без «темно», «не вижу лицо» и «подними руку»', () => {
    const black = { brightness: 0.01, right: null, head: { z: 0.6, visible: false, yawDeg: 0 }, noFaceMs: 5000, noHandsMs: 5000, inTutorial: true }
    expect(codes(black)).toEqual(['camera-blocked'])
  })

  it('просто темно, но что-то видно — подсказка про свет', () => {
    expect(codes({ brightness: 0.1 })).toContain('dark')
  })
})

describe('«подними руку»', () => {
  it('в обучении рук не видно — подсказываем', () => {
    expect(codes({ right: null, noHandsMs: 2000, inTutorial: true })).toContain('no-hands')
  })

  it('в игре опущенные руки — это отдых: не пристаём', () => {
    expect(codes({ right: null, noHandsMs: 5000 })).not.toContain('no-hands')
  })
})

describe('подсказки не пристают', () => {
  it('на экране одна подсказка — самая важная', () => {
    const f = new HintFilter()
    // Обе без задержки: «не та рука» и «не вижу лицо» — показываем только важную.
    expect(f.update([hint('wrong-hand'), hint('no-face')], 0).hints.map((h) => h.code)).toEqual(['no-face'])
  })

  it('ушла — не возвращается 8 секунд, даже если ошибка повторилась', () => {
    const f = new HintFilter()
    expect(f.update([hint('no-face')], 0).hints).toHaveLength(1)
    f.update([], 100)
    // Подсказка висит ещё немного и уходит…
    expect(f.update([], 1700).hints).toHaveLength(0)
    // …ошибка вернулась почти сразу — молчим…
    expect(f.update([hint('no-face')], 2000).hints).toHaveLength(0)
    // …а если держится и через 8 секунд — подсказываем снова.
    expect(f.update([hint('no-face')], 9800).hints.map((h) => h.code)).toEqual(['no-face'])
  })
})
