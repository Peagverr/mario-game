import { describe, expect, it } from 'vitest'
import { armsFromPose, HandIdentity, KEEP_MS, type ArmRef, type FaceRef, type HandSeen } from './handIdentity'

/** Кадр 4:3, лицо посередине; кадры — 30 в секунду. */
const ASPECT = 4 / 3
const FACE: FaceRef = { x: 0.67, y: 0.4, w: 0.28 }
const FRAME_MS = 33

const hand = (x: number, y: number, label: HandSeen['label'], o: Partial<HandSeen> = {}): HandSeen => ({
  x,
  y,
  label,
  score: 0.95,
  fist: false,
  ...o,
})

/** Прогнать кадры: frames(i) — руки i-го кадра. Возвращает стороны последнего кадра. */
function run(id: HandIdentity, n: number, frames: (i: number) => HandSeen[], t0 = 0, face: FaceRef | null = FACE) {
  let out: ReturnType<HandIdentity['assign']> = []
  for (let i = 0; i < n; i++) out = id.assign(frames(i), t0 + i * FRAME_MS, face, ASPECT)
  return out
}

describe('какая рука левая, а какая правая', () => {
  it('левая рука уходит правее головы — остаётся левой, даже если MediaPipe стал звать её правой', () => {
    const id = new HandIdentity()
    // Левая ладонь левее лица — 10 кадров.
    expect(run(id, 10, () => [hand(0.35, 0.5, 'left')])).toEqual(['left'])
    // Ведём её вправо через лицо до 1.1 (правее головы на 1,5 ширины лица) за 20 кадров, метка «правая».
    const out = run(id, 20, (i) => [hand(0.35 + ((1.1 - 0.35) * (i + 1)) / 20, 0.5, 'right', { score: 0.7 })], 330)
    expect(out).toEqual(['left'])
  })

  it('левый кулак правее головы — левый (про кулак метке не верим вовсе)', () => {
    const id = new HandIdentity()
    run(id, 10, () => [hand(0.4, 0.55, 'left', { fist: true })])
    const out = run(id, 60, (i) => [hand(0.4 + Math.min(0.7, i * 0.03), 0.55, 'right', { fist: true, score: 0.99 })], 330)
    expect(out).toEqual(['left'])
  })

  it('метка мигает на чужую сторону несколько кадров — сторона не меняется', () => {
    const id = new HandIdentity()
    run(id, 10, () => [hand(1.0, 0.5, 'right')])
    const out = run(id, 30, (i) => [hand(1.0, 0.5, i % 3 ? 'right' : 'left')], 330)
    expect(out).toEqual(['right'])
  })

  it('при появлении ошиблись, а раскрытая ладонь долго и уверенно другая — сторона исправляется', () => {
    const id = new HandIdentity()
    // Правая ладонь появилась прямо на линии лица, метка «левая» с малой уверенностью — назвали левой.
    expect(run(id, 10, () => [hand(0.67, 0.5, 'left', { score: 0.55 })])).toEqual(['left'])
    // Дальше MediaPipe уверенно говорит «правая» почти секунду.
    expect(run(id, 30, () => [hand(0.67, 0.5, 'right', { score: 0.98 })], 330)).toEqual(['right'])
  })

  it('в первые кадры MediaPipe передумал — сторона новой руки поправляется сразу', () => {
    const id = new HandIdentity()
    // Первый кадр: рука прямо под лицом, метка «левая», но неуверенно.
    expect(id.assign([hand(0.67, 0.6, 'left', { score: 0.6 })], 0, FACE, ASPECT)).toEqual(['left'])
    // Следующие кадры (ещё в первые 200 мс): уверенно «правая».
    expect(run(id, 4, () => [hand(0.67, 0.6, 'right', { score: 0.9 })], 33)).toEqual(['right'])
    // И дальше остаётся правой.
    expect(run(id, 20, () => [hand(0.67, 0.6, 'right', { score: 0.9 })], 200)).toEqual(['right'])
  })

  it('две руки скрестились — каждая остаётся собой', () => {
    const id = new HandIdentity()
    run(id, 10, () => [hand(0.4, 0.5, 'left'), hand(0.95, 0.5, 'right')])
    // Руки едут навстречу и меняются местами, метки MediaPipe тоже меняются.
    const out = run(
      id,
      30,
      (i) => {
        const k = (i + 1) / 30
        return [hand(0.4 + 0.55 * k, 0.5, k > 0.5 ? 'right' : 'left'), hand(0.95 - 0.55 * k, 0.6, k > 0.5 ? 'left' : 'right')]
      },
      330,
    )
    expect(out).toEqual(['left', 'right'])
  })

  it('видна одна рука — вторая новая получает свободную сторону, даже с чужой меткой', () => {
    const id = new HandIdentity()
    run(id, 10, () => [hand(0.95, 0.5, 'right')])
    expect(id.assign([hand(0.95, 0.5, 'right'), hand(0.4, 0.5, 'right')], 400, FACE, ASPECT)).toEqual(['right', 'left'])
  })

  it('рука пропала надолго и появилась в другом месте — сторона решается заново по метке и положению', () => {
    const id = new HandIdentity()
    run(id, 10, () => [hand(0.35, 0.5, 'left')])
    const t = 330 + KEEP_MS + 2500
    expect(id.assign([hand(1.0, 0.5, 'right')], t, FACE, ASPECT)).toEqual(['right'])
  })

  it('рука на миг пропала (смазалась) и появилась рядом — та же сторона, хоть и правее головы', () => {
    const id = new HandIdentity()
    run(id, 10, (i) => [hand(0.5 + i * 0.04, 0.5, 'left', { fist: true })])
    // Пропала на 200 мс, появилась чуть дальше по ходу — правее лица.
    expect(id.assign([hand(1.05, 0.5, 'right', { fist: true })], 9 * FRAME_MS + 200, FACE, ASPECT)).toEqual(['left'])
  })

  it('резкий рывок: рука пропала почти на полсекунды и появилась далеко по ходу движения — узнаётся (ждали её там)', () => {
    const id = new HandIdentity()
    // Левый кулак быстро едет вправо (0.9 высоты кадра в секунду)…
    run(id, 10, (i) => [hand(0.3 + i * 0.03, 0.5, 'left', { fist: true })])
    // …пропал на 450 мс и появился на 0.75 дальше: от последнего места далеко, от ожидаемого — близко.
    const t = 9 * FRAME_MS + 450
    expect(id.assign([hand(0.57 + 0.75, 0.5, 'right', { fist: true })], t, FACE, ASPECT)).toEqual(['left'])
  })

  it('призрак на 1–2 кадра не занимает сторону', () => {
    const id = new HandIdentity()
    id.assign([hand(0.67, 0.4, 'right')], 0, FACE, ASPECT)
    id.assign([], 33, FACE, ASPECT)
    // Через 60 мс правая ладонь у джойстика: призрак забыт, левой её не назовут.
    expect(id.assign([hand(1.05, 0.62, 'right')], 66, FACE, ASPECT)).toEqual(['right'])
  })
})

describe('какая рука левая, а какая правая: по позе тела', () => {
  /** Запястье руки — чуть ниже центра ладони, размер ладони 0.15 высоты кадра. */
  const fist = (x: number, y: number, label: HandSeen['label'] = 'right') =>
    hand(x, y, label, { fist: true, score: 0.9, wrist: { x, y: y + 0.08 }, size: 0.15 })
  /** Поза: запястья рук тела там, где запястья рук (с небольшим отставанием позы). */
  const arms = (left: { x: number; y: number } | null, right: { x: number; y: number } | null): ArmRef => ({
    left: left && { x: left.x + 0.02, y: left.y + 0.08 },
    right: right && { x: right.x - 0.02, y: right.y + 0.08 },
  })

  it('левый кулак подняли сразу правее головы — по позе он левый (без позы был бы правым)', () => {
    const noPose = new HandIdentity()
    expect(run(noPose, 10, () => [fist(1.05, 0.5)])).toEqual(['right'])

    const id = new HandIdentity()
    let out: ReturnType<HandIdentity['assign']> = []
    for (let i = 0; i < 10; i++) out = id.assign([fist(1.05, 0.5)], i * FRAME_MS, FACE, ASPECT, arms({ x: 1.05, y: 0.5 }, null))
    expect(out).toEqual(['left'])
  })

  it('видно только правое запястье тела, а кулак далеко от него — это левая рука', () => {
    const id = new HandIdentity()
    const out = id.assign([fist(1.0, 0.5)], 0, FACE, ASPECT, { left: null, right: { x: 0.3, y: 0.95 } })
    expect(out).toEqual(['left'])
  })

  it('поза пришла поздно: кулак сначала назвали правым, поза долго говорит «левая рука» — сторона исправляется', () => {
    const id = new HandIdentity()
    expect(run(id, 10, () => [fist(1.05, 0.5)])).toEqual(['right'])
    let out: ReturnType<HandIdentity['assign']> = []
    for (let i = 0; i < 30; i++) out = id.assign([fist(1.05, 0.5)], 330 + i * FRAME_MS, FACE, ASPECT, arms({ x: 1.05, y: 0.5 }, null))
    expect(out).toEqual(['left'])
  })

  it('поза на пару кадров ошиблась — сторона не меняется', () => {
    const id = new HandIdentity()
    for (let i = 0; i < 10; i++) id.assign([fist(0.4, 0.5, 'left')], i * FRAME_MS, FACE, ASPECT, arms({ x: 0.4, y: 0.5 }, null))
    let out: ReturnType<HandIdentity['assign']> = []
    for (let i = 0; i < 20; i++) {
      const wrong = i % 5 < 2 ? arms(null, { x: 0.4, y: 0.5 }) : arms({ x: 0.4, y: 0.5 }, null)
      out = id.assign([fist(0.4, 0.5, 'left')], 330 + i * FRAME_MS, FACE, ASPECT, wrong)
    }
    expect(out).toEqual(['left'])
  })

  it('руки появились скрещёнными — по позе стороны верные сразу', () => {
    const id = new HandIdentity()
    // Левая рука правее на экране, правая — левее (руки скрещены перед лицом).
    const L = { x: 0.9, y: 0.55 }
    const R = { x: 0.45, y: 0.55 }
    const out = id.assign([fist(L.x, L.y), fist(R.x, R.y, 'left')], 0, FACE, ASPECT, arms(L, R))
    expect(out).toEqual(['left', 'right'])
  })

  it('обе руки узнаны наоборот (без позы), потом поза долго говорит обратное — меняются местами', () => {
    const id = new HandIdentity()
    const L = { x: 0.9, y: 0.55 }
    const R = { x: 0.45, y: 0.55 }
    expect(run(id, 10, () => [fist(L.x, L.y), fist(R.x, R.y, 'left')])).toEqual(['right', 'left'])
    let out: ReturnType<HandIdentity['assign']> = []
    for (let i = 0; i < 30; i++) out = id.assign([fist(L.x, L.y), fist(R.x, R.y, 'left')], 330 + i * FRAME_MS, FACE, ASPECT, arms(L, R))
    expect(out).toEqual(['left', 'right'])
  })

  it('рука пропала надолго и появилась далеко — по позе узнаётся', () => {
    const id = new HandIdentity()
    run(id, 10, () => [fist(0.4, 0.5, 'left')])
    const t = 330 + 1500
    expect(id.assign([fist(1.1, 0.4)], t, FACE, ASPECT, arms({ x: 1.1, y: 0.4 }, null))).toEqual(['left'])
  })

  it('поза нужна, когда рука новая или только появилась; знакомой руке — нет', () => {
    const id = new HandIdentity()
    const h = [fist(0.4, 0.5, 'left')]
    expect(id.needsArms(h, 0)).toBe(true)
    run(id, 10, () => h)
    expect(id.needsArms(h, 330)).toBe(false)
    expect(id.needsArms([...h, fist(1.0, 0.5)], 363)).toBe(true)
  })
})

describe('поза тела → запястья рук', () => {
  /** 33 точки позы; задаём плечи и запястья в координатах кадра БЕЗ зеркала (как отдаёт MediaPipe). */
  const pose = (p: Record<number, { x: number; y: number; visibility?: number }>) =>
    Array.from({ length: 33 }, (_, i) => p[i] ?? { x: 0.5, y: 0.5, visibility: 0.1 })

  it('левая рука игрока — та, чьё плечо слева на экране (в кадре без зеркала — справа), как бы модель её ни назвала', () => {
    // Игрок лицом к камере: его левое плечо в кадре без зеркала справа (x 0.65), правое — слева (0.35).
    // Левое запястье поднято правее головы: в кадре без зеркала x 0.3.
    const lm = pose({ 11: { x: 0.65, y: 0.8, visibility: 0.9 }, 12: { x: 0.35, y: 0.8, visibility: 0.9 }, 15: { x: 0.3, y: 0.5, visibility: 0.9 }, 16: { x: 0.6, y: 0.95, visibility: 0.2 } })
    const a = armsFromPose(lm, ASPECT)!
    expect(a.left!.x).toBeCloseTo((1 - 0.3) * ASPECT)
    expect(a.right).toBeNull()
    // Модель назвала стороны наоборот (11 и 12 поменяны) — ответ тот же.
    const swapped = pose({ 12: { x: 0.65, y: 0.8, visibility: 0.9 }, 11: { x: 0.35, y: 0.8, visibility: 0.9 }, 16: { x: 0.3, y: 0.5, visibility: 0.9 }, 15: { x: 0.6, y: 0.95, visibility: 0.2 } })
    expect(armsFromPose(swapped, ASPECT)).toEqual(a)
  })

  it('плеч не видно — поза не помогает', () => {
    expect(armsFromPose(pose({ 11: { x: 0.65, y: 0.8, visibility: 0.2 }, 12: { x: 0.35, y: 0.8, visibility: 0.9 } }), ASPECT)).toBeNull()
    expect(armsFromPose(undefined, ASPECT)).toBeNull()
  })
})
