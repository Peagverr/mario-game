import { describe, expect, it } from 'vitest'
import { PALM_DEFAULTS, PalmJoystick, type FaceAnchor, type PalmFrame, type PalmParams, type PalmState } from './palmJoystick'

/**
 * Координаты — «квадратные»: x·(ширина/высота кадра), y — доли высоты кадра. Кадр 4:3.
 * Круг стоит в кадре справа внизу: 75% ширины и 70% высоты кадра → центр (1.0, 0.7). К лицу не привязан.
 * Лицо шириной 0.3 задаёт только размер: центр (стоп) — 0.2 ширины лица, полная скорость — 0.6 ширины лица.
 */
const ASPECT = 4 / 3
const FACE: FaceAnchor = { x: 0.6, y: 0.4, w: 0.3 }
const PARAMS: PalmParams = { anchorX: 0.75, anchorY: 0.7, dead: 0.2, full: 0.6, downGain: 1, minSpeed: 0.5 }
const CENTER = { x: 1, y: 0.7 }

/** Точка, сдвинутая от центра кольца на dx, dy ширин лица (dy > 0 — ВВЕРХ, как рука поднимается). */
const at = (dx: number, dy: number, c = CENTER) => ({ x: c.x + dx * FACE.w, y: c.y - dy * FACE.w })
const speed = (s: PalmState) => Math.hypot(s.move.x, s.move.y)

function joystick(params: Partial<PalmParams> = {}) {
  const j = new PalmJoystick({ ...PARAMS, ...params })
  let t = 0
  /** Один кадр камеры (~30 к/с). */
  const frame = (palm: PalmFrame['palm'], opts: Partial<PalmFrame> = {}) =>
    j.update({ t: (t += 33), palm, face: FACE, aspect: ASPECT, suspended: false, calibrating: false, ...opts })
  const wait = (ms: number) => void (t += ms)
  return { j, frame, wait }
}

describe('ладонь-джойстик справа внизу', () => {
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

  it('круг стоит в кадре справа внизу и не следует за лицом', () => {
    const { frame } = joystick()
    const s = frame(null)
    expect(s.center.x).toBeCloseTo(CENTER.x)
    expect(s.center.y).toBeCloseTo(CENTER.y)
    // Игрок сдвинулся и наклонил голову (эффект окна) — круг на месте.
    const moved = frame(null, { face: { x: 0.3, y: 0.55, w: 0.3 } })
    expect(moved.center.x).toBeCloseTo(CENTER.x)
    expect(moved.center.y).toBeCloseTo(CENTER.y)
  })

  it('по умолчанию круг — в правой нижней четверти кадра, но не у самого края', () => {
    const s = new PalmJoystick().update({ t: 0, palm: null, face: FACE, aspect: ASPECT, suspended: false, calibrating: false })
    expect(s.center.x / ASPECT).toBeGreaterThan(0.6)
    expect(s.center.y).toBeGreaterThan(0.55)
    // Ниже центра ладони — ещё запястье, и «назад» рука уходит вниз: кадр не должен её обрезать.
    expect(PALM_DEFAULTS.anchorY).toBeLessThan(0.8)
    expect(PALM_DEFAULTS.anchorX).toBeLessThan(0.85)
  })

  it('размер круга — в ширинах лица: сел дальше от камеры — круг меньше', () => {
    const { frame } = joystick()
    // Радиусы для рисования — в долях высоты кадра: 0.2 и 0.6 ширины лица 0.3.
    const near = frame(null)
    expect(near.dead).toBeCloseTo(0.06)
    expect(near.full).toBeCloseTo(0.18)
    const far = frame(null, { face: { ...FACE, w: 0.2 } })
    expect(far.dead).toBeCloseTo(0.04)
    expect(far.full).toBeCloseTo(0.12)
  })

  it('лица ещё не видели — круг обычного размера на своём месте', () => {
    const { frame } = joystick()
    const s = frame(null, { face: null })
    expect(s.center.x).toBeCloseTo(CENTER.x)
    expect(s.center.y).toBeCloseTo(CENTER.y)
    expect(s.full).toBeGreaterThan(0.1)
    expect(s.full).toBeLessThan(0.25)
  })

  it('«палка»: где ладонь относительно круга (1 — край круга), даже пока джойстик не готов', () => {
    const { frame } = joystick({ downGain: 2 })
    const right = frame(at(0.3, 0))
    expect(right.armed).toBe(false)
    expect(right.stick?.x).toBeCloseTo(0.5)
    expect(right.stick?.y).toBeCloseTo(0)
    frame(at(0, 0))
    // Вниз — с тем же усилением, что и ходьба: точка уходит из центра ровно тогда, когда герой пошёл.
    const down = frame(at(0, -0.3))
    expect(down.stick?.y).toBeCloseTo(-1)
    expect(down.move.y).toBeCloseTo(-1)
    // Ладони не видно — и точки нет.
    expect(frame(null, { suspended: true }).stick).toBeNull()
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

  it('«Поставить круг заново»: кольцо под ладонью, герой стоит; потом это место — центр', () => {
    const { j, frame } = joystick()
    const palm = { x: 0.85 * ASPECT, y: 0.6 }
    const calibrating = frame(palm, { calibrating: true })
    expect(speed(calibrating)).toBe(0)
    expect(calibrating.center.x).toBeCloseTo(palm.x)
    expect(calibrating.center.y).toBeCloseTo(palm.y)

    j.calibrate(palm, ASPECT)
    expect(j.params.anchorX).toBeCloseTo(0.85)
    expect(j.params.anchorY).toBeCloseTo(0.6)
    const ready = frame(palm)
    expect(ready.armed).toBe(true)
    expect(speed(ready)).toBe(0)
    expect(frame(at(0, 0.6, palm)).move.y).toBeCloseTo(1)
    // Новое место тоже не зависит от лица.
    expect(frame(null, { face: { x: 0.2, y: 0.3, w: 0.3 } }).center.x).toBeCloseTo(palm.x)
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
    j.restore({ dead: -5, full: 99, anchorX: Number.NaN, anchorY: 'вниз' } as unknown as Record<string, unknown>)
    // Круг на месте и работает: центр — стоп, дальше — идём.
    const s = frame(null)
    expect(s.center.x).toBeCloseTo(CENTER.x)
    expect(s.center.y).toBeCloseTo(CENTER.y)
    frame(at(0, 0, s.center))
    expect(speed(frame(at(0.05, 0, s.center)))).toBe(0)
    expect(speed(frame(at(1.2, 0, s.center)))).toBeGreaterThan(0)
  })

  it('хорошие сохранённые настройки восстанавливаются', () => {
    const { j, frame } = joystick()
    j.restore({ anchorX: 0.8, anchorY: 0.65 })
    const s = frame(null)
    expect(s.center.x).toBeCloseTo(0.8 * ASPECT)
    expect(s.center.y).toBeCloseTo(0.65)
  })

  it('старые настройки «круг у лица» не переезжают в новый круг', () => {
    const { j, frame } = joystick()
    j.restore({ offsetX: 1.5, offsetY: 0.5 })
    const s = frame(null)
    expect(s.center.x).toBeCloseTo(CENTER.x)
    expect(s.center.y).toBeCloseTo(CENTER.y)
  })

  it('«Поставить заново» не уводит круг на лицо, влево или к краю кадра', () => {
    const { j, frame } = joystick()
    j.calibrate({ x: 0.3 * ASPECT, y: 0.1 }, ASPECT)
    const up = frame(null)
    expect(up.center.x / ASPECT).toBeGreaterThanOrEqual(0.55)
    expect(up.center.y).toBeGreaterThanOrEqual(0.35)
    j.calibrate({ x: 0.99 * ASPECT, y: 0.99 }, ASPECT)
    const edge = frame(null)
    expect(edge.center.x / ASPECT).toBeLessThan(0.95)
    expect(edge.center.y).toBeLessThan(0.9)
  })
})
