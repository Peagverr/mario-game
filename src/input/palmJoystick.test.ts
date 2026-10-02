import { describe, expect, it } from 'vitest'
import { PalmJoystick, type FaceAnchor, type PalmFrame, type PalmParams, type PalmState } from './palmJoystick'

/**
 * Координаты — «квадратные»: x·(ширина/высота кадра), y — доли высоты кадра.
 * Лицо шириной 0.3; кольцо на 1 ширину лица правее и ниже лица → центр кольца (0.9, 0.7).
 * Центр (стоп) — радиус 0.2 ширины лица, полная скорость — 0.6 ширины лица.
 */
const FACE: FaceAnchor = { x: 0.6, y: 0.4, w: 0.3 }
const PARAMS: PalmParams = { offsetX: 1, offsetY: 1, dead: 0.2, full: 0.6, downGain: 1, minSpeed: 0.5 }
const CENTER = { x: 0.9, y: 0.7 }

/** Точка, сдвинутая от центра кольца на dx, dy ширин лица (dy > 0 — ВВЕРХ, как рука поднимается). */
const at = (dx: number, dy: number, c = CENTER) => ({ x: c.x + dx * FACE.w, y: c.y - dy * FACE.w })
const speed = (s: PalmState) => Math.hypot(s.move.x, s.move.y)

function joystick(params: Partial<PalmParams> = {}) {
  const j = new PalmJoystick({ ...PARAMS, ...params })
  let t = 0
  /** Один кадр камеры (~30 к/с). */
  const frame = (palm: PalmFrame['palm'], opts: Partial<PalmFrame> = {}) =>
    j.update({ t: (t += 33), palm, face: FACE, suspended: false, calibrating: false, ...opts })
  const wait = (ms: number) => void (t += ms)
  return { j, frame, wait }
}

describe('ладонь у лица', () => {
  it('рука, поднятая снизу, не двигает героя, пока ладонь не побывала в центре', () => {
    const { frame } = joystick()
    // Рука появилась у нижнего края и поднимается к кольцу: всё это время она «ниже» центра.
    expect(speed(frame(at(0, -0.9)))).toBe(0)
    const rising = frame(at(0, -0.5))
    expect(rising.armed).toBe(false)
    expect(speed(rising)).toBe(0)
    // Дошла до центра — джойстик готов, но герой стоит.
    const inCenter = frame(at(0, 0))
    expect(inCenter.armed).toBe(true)
    expect(speed(inCenter)).toBe(0)
    // Теперь вверх — вперёд.
    const up = frame(at(0, 0.6))
    expect(up.move.x).toBeCloseTo(0)
    expect(up.move.y).toBeCloseTo(1)
  })

  it.each([
    ['вверх — вперёд', 0, 0.6, 0, 1, 1],
    ['вниз — назад', 0, -0.6, 0, -1, 3],
    ['вправо — вправо', 0.6, 0, 1, 0, 0],
    ['влево — влево', -0.6, 0, -1, 0, 2],
  ])('%s', (_, dx, dy, mx, my, sector) => {
    const { frame } = joystick()
    frame(at(0, 0))
    const s = frame(at(dx, dy))
    expect(s.move.x).toBeCloseTo(mx)
    expect(s.move.y).toBeCloseTo(my)
    expect(s.sector).toBe(sector)
  })

  it('чуть вышел из центра — медленно, у края кольца — полная скорость', () => {
    const { frame } = joystick()
    frame(at(0, 0))
    // Скорость растёт от 0.5 на границе центра (0.2) до 1 на краю кольца (0.6).
    expect(speed(frame(at(0.21, 0)))).toBeCloseTo(0.5125, 4)
    expect(speed(frame(at(0.4, 0)))).toBeCloseTo(0.75)
    expect(speed(frame(at(1.2, 0)))).toBeCloseTo(1)
  })

  it('направление — как у руки: к осям мира притягивает уже сам герой (walk.ts), даже когда мир повёрнут', () => {
    const { frame } = joystick()
    frame(at(0, 0))
    const a = (10 * Math.PI) / 180
    const nearAxis = frame(at(0.6 * Math.cos(a), 0.6 * Math.sin(a)))
    expect(nearAxis.move.x).toBeCloseTo(Math.cos(a))
    expect(nearAxis.move.y).toBeCloseTo(Math.sin(a))
    expect(nearAxis.sector).toBe(0)
    const diagonal = frame(at(0.6 * Math.SQRT1_2, 0.6 * Math.SQRT1_2))
    expect(diagonal.move.x).toBeCloseTo(diagonal.move.y)
    expect(diagonal.move.x).toBeGreaterThan(0.5)
  })

  it('вниз нужно меньшее движение: руке мешают стол и локоть', () => {
    const { frame } = joystick({ downGain: 2 })
    frame(at(0, 0))
    expect(frame(at(0, -0.3)).move.y).toBeCloseTo(-1)
  })

  it('на границе центра не мигает «иду — стою»', () => {
    const { frame } = joystick()
    frame(at(0, 0))
    expect(speed(frame(at(0.21, 0)))).toBeGreaterThan(0)
    // Рука дрогнула чуть внутрь границы — всё ещё идём…
    expect(speed(frame(at(0.19, 0)))).toBeGreaterThan(0)
    // …а по-настоящему вернул ладонь в центр — стоим.
    expect(speed(frame(at(0.1, 0)))).toBe(0)
  })

  it('пока рука поднята, движение головы не двигает героя: кольцо стоит на месте', () => {
    const { frame } = joystick()
    expect(frame(at(0, 0)).armed).toBe(true)
    // Игрок поднял голову, чтобы заглянуть через стену (уровень «Загляни»); рука — на месте.
    const headUp = { ...FACE, y: FACE.y - 0.1 }
    expect(speed(frame(at(0, 0), { face: headUp }))).toBe(0)
  })

  it('пока руки нет, кольцо следует за лицом', () => {
    const { frame } = joystick()
    const s = frame(null, { face: { x: 0.5, y: 0.45, w: 0.3 } })
    expect(s.center.x).toBeCloseTo(0.8)
    expect(s.center.y).toBeCloseTo(0.75)
    // Радиусы для рисования — в долях высоты кадра: 0.2 и 0.6 ширины лица 0.3.
    expect(s.dead).toBeCloseTo(0.06)
    expect(s.full).toBeCloseTo(0.18)
  })

  it('лицо пропало (например, его закрыла рука) — кольцо остаётся, где было', () => {
    const { frame } = joystick()
    frame(null)
    const s = frame(null, { face: null })
    expect(s.center.x).toBeCloseTo(CENTER.x)
    expect(s.center.y).toBeCloseTo(CENTER.y)
  })

  it('короткий сбой распознавания руки не останавливает героя', () => {
    const { frame } = joystick()
    frame(at(0, 0))
    expect(frame(at(0, 0.6)).move.y).toBeCloseTo(1)
    // Один-два кадра без руки — идём дальше.
    expect(frame(null).move.y).toBeCloseTo(1)
    expect(frame(null).move.y).toBeCloseTo(1)
    // Рука вернулась туда же — идём, заново в центр заходить не нужно.
    expect(frame(at(0, 0.6)).move.y).toBeCloseTo(1)
  })

  it('рука пропала надолго — снова нужен центр', () => {
    const { frame, wait } = joystick()
    frame(at(0, 0))
    expect(frame(at(0, 0.6)).move.y).toBeCloseTo(1)
    wait(600)
    frame(null)
    // Рука вернулась сразу «вверх» — герой стоит, пока ладонь не зайдёт в центр.
    const back = frame(at(0, 0.6))
    expect(back.armed).toBe(false)
    expect(speed(back)).toBe(0)
  })

  it('открытое меню останавливает героя, после меню — снова через центр', () => {
    const { frame } = joystick()
    frame(at(0, 0))
    expect(frame(at(0, 0.6)).move.y).toBeCloseTo(1)
    expect(speed(frame(at(0, 0.6), { suspended: true }))).toBe(0)
    const after = frame(at(0, 0.6))
    expect(after.armed).toBe(false)
    expect(speed(after)).toBe(0)
  })

  it('пока держишь две ладони (меню ещё открывается) — стоим, но заново в центр заходить не нужно', () => {
    const { frame } = joystick()
    frame(at(0, 0))
    expect(frame(at(0, 0.6)).move.y).toBeCloseTo(1)
    // Левая ладонь раскрылась (например, перед хватом кулаком) — герой стоит…
    expect(speed(frame(at(0, 0.6), { holdStill: true }))).toBe(0)
    // …а как только она сжалась в кулак, идём дальше — правую руку возвращать в центр не нужно.
    expect(frame(at(0, 0.6)).move.y).toBeCloseTo(1)
  })

  it('калибровка: кольцо под ладонью, герой стоит; потом это место — центр', () => {
    const { j, frame } = joystick()
    const palm = { x: FACE.x + 1.5 * FACE.w, y: FACE.y + 0.5 * FACE.w }
    const calibrating = frame(palm, { calibrating: true })
    expect(speed(calibrating)).toBe(0)
    expect(calibrating.center.x).toBeCloseTo(palm.x)
    expect(calibrating.center.y).toBeCloseTo(palm.y)

    j.calibrate(palm, FACE)
    const ready = frame(palm)
    expect(ready.armed).toBe(true)
    expect(speed(ready)).toBe(0)
    expect(frame(at(0, 0.6, palm)).move.y).toBeCloseTo(1)
  })

  it('«круг больше» — центр шире и до полной скорости дальше', () => {
    const { j, frame } = joystick()
    j.resize(1.25)
    frame(at(0, 0))
    // При прежнем центре (0.2) тут уже шли бы…
    expect(speed(frame(at(0.22, 0)))).toBe(0)
    // …а тут была бы полная скорость.
    expect(speed(frame(at(0.6, 0)))).toBeLessThan(1)
  })

  it('круг нельзя сжать в точку: центр и ходьба остаются', () => {
    const { j, frame } = joystick()
    for (let i = 0; i < 20; i++) j.resize(0.8)
    frame(at(0, 0))
    expect(speed(frame(at(0.1, 0)))).toBe(0)
    expect(speed(frame(at(0.6, 0)))).toBeGreaterThan(0)
  })

  it('испорченные сохранённые настройки не ломают круг', () => {
    const { j, frame } = joystick()
    j.restore({ dead: -5, full: 99, offsetX: Number.NaN, offsetY: 'вниз' } as unknown as Record<string, unknown>)
    // Круг на месте и работает: центр — стоп, дальше — идём.
    const s = frame(null)
    expect(Number.isFinite(s.center.x)).toBe(true)
    expect(s.center.x - FACE.x).toBeGreaterThan(0.5 * FACE.w)
    frame(at(0, 0, s.center))
    expect(speed(frame(at(0.05, 0, s.center)))).toBe(0)
    expect(speed(frame(at(1.2, 0, s.center)))).toBeGreaterThan(0)
  })

  it('хорошие сохранённые настройки восстанавливаются', () => {
    const { j, frame } = joystick()
    j.restore({ offsetX: 1.5, offsetY: 0.5 })
    const s = frame(null)
    expect(s.center.x).toBeCloseTo(FACE.x + 1.5 * FACE.w)
    expect(s.center.y).toBeCloseTo(FACE.y + 0.5 * FACE.w)
  })

  it('калибровка с ладонью перед лицом не ставит кольцо на лицо', () => {
    const { j, frame } = joystick()
    j.calibrate({ x: FACE.x, y: FACE.y }, FACE)
    const s = frame(null)
    // Лицо — это ±0.5 ширины от его центра: кольцо должно оказаться правее края лица.
    expect(s.center.x - FACE.x).toBeGreaterThan(0.5 * FACE.w)
  })
})
