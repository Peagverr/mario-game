import { describe, expect, it } from 'vitest'
import { fingerCurls } from '../../input/gestures'
import { decodeClip, encodeClip, FRAME_LEN, makeClip, sampleClip, type HandClip } from './clip'
import { OPEN_POSE, poseHand, type HandPose } from './handPose'
import { proceduralClips } from './proceduralClips'
import { recordingToClip, type RecordedSample } from './recording'

/** Кости MediaPipe (пары точек), длины которых у живой руки не меняются. */
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
]

const pt = (f: ArrayLike<number>, i: number) => ({ x: f[i * 3], y: f[i * 3 + 1], z: f[i * 3 + 2] })
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const frame = (c: HandClip, i: number) => c.points.subarray(i * FRAME_LEN, (i + 1) * FRAME_LEN)
/** Оси клипа → worldLandmarks трекера (y вниз, z от камеры) — чтобы проверить позу распознаванием игры. */
const toTracker = (f: ArrayLike<number>) => Array.from({ length: 21 }, (_, i) => ({ x: f[i * 3], y: -f[i * 3 + 1], z: -f[i * 3 + 2] }))

const FIST: HandPose = { ...OPEN_POSE, curl: [1, 1, 1, 1, 1], spread: 0 }
const clips = proceduralClips()

describe('процедурная рука', () => {
  it('раскрытую ладонь распознавание игры видит как раскрытую, кулак — как кулак', () => {
    expect(fingerCurls(toTracker(poseHand(OPEN_POSE, 'right')))).toEqual(['extended', 'extended', 'extended', 'extended', 'extended'])
    // Большой палец в кулаке лежит поверх средних фаланг — распознавание кулака его и не спрашивает.
    expect(fingerCurls(toTracker(poseHand(FIST, 'right'))).slice(1)).toEqual(['curled', 'curled', 'curled', 'curled'])
  })

  it('правая — большой палец слева (как в зеркале), левая — справа', () => {
    const r = poseHand(OPEN_POSE, 'right')
    const l = poseHand(OPEN_POSE, 'left')
    expect(pt(r, 4).x).toBeLessThan(pt(r, 20).x)
    expect(pt(l, 4).x).toBeGreaterThan(pt(l, 20).x)
  })

  it('пропорции взрослой руки: ~18 см от запястья до кончика среднего, пальцы вверх', () => {
    const p = poseHand(OPEN_POSE, 'right')
    const len = dist(pt(p, 0), pt(p, 12))
    expect(len).toBeGreaterThan(0.17)
    expect(len).toBeLessThan(0.2)
    expect(pt(p, 12).y).toBeGreaterThan(pt(p, 0).y)
  })

  it('в кулаке кончики пальцев у ладони, большой палец обхватывает их спереди', () => {
    const p = poseHand(FIST, 'right')
    expect(pt(p, 4).z).toBeGreaterThan(pt(p, 6).z)
    expect(pt(p, 4).x).toBeGreaterThan(pt(p, 6).x)
    for (const tip of [8, 12, 16, 20]) expect(dist(pt(p, tip), pt(p, 0))).toBeLessThan(dist(pt(p, tip - 3), pt(p, 0)) * 1.05)
    // Кулак ладонью к зрителю: пальцы сворачиваются к зрителю, а не сквозь тыльную сторону.
    for (let i = 0; i < 21; i++) expect(pt(p, i).z).toBeGreaterThan(-0.02)
  })
})

describe('процедурные клипы', () => {
  it.each(clips.map((c) => [c.name, c] as const))('%s: длины костей одни и те же во всех кадрах', (_, c) => {
    for (const [a, b] of BONES) {
      const ref = dist(pt(frame(c, 0), a), pt(frame(c, 0), b))
      for (let i = 1; i < c.count; i++) expect(dist(pt(frame(c, i), a), pt(frame(c, i), b))).toBeCloseTo(ref, 5)
    }
  })

  it.each(clips.map((c) => [c.name, c] as const))('%s: цикл без скачка — последний кадр рядом с первым', (_, c) => {
    const first = frame(c, 0)
    const last = frame(c, c.count - 1)
    for (let i = 0; i < 21; i++) expect(dist(pt(first, i), pt(last, i))).toBeLessThan(0.01)
    expect(Math.abs(c.move[0] - c.move[(c.count - 1) * 3])).toBeLessThan(0.01)
    expect(Math.abs(c.move[1] - c.move[(c.count - 1) * 3 + 1])).toBeLessThan(0.01)
  })

  it('«кулак» действительно сжимается в кулак, а «ладонь» остаётся раскрытой', () => {
    const fistClip = clips.find((c) => c.name === 'fist')!
    const curlsAt = (c: HandClip, t: number) => fingerCurls(toTracker(frame(c, Math.round(t * c.fps))))
    expect(curlsAt(fistClip, 0.2).slice(1)).toEqual(['extended', 'extended', 'extended', 'extended'])
    expect(curlsAt(fistClip, 1.2).slice(1)).toEqual(['curled', 'curled', 'curled', 'curled'])
    const move = clips.find((c) => c.name === 'palm-move')!
    for (let i = 0; i < move.count; i++) expect(fingerCurls(toTracker(frame(move, i))).slice(1)).toEqual(['extended', 'extended', 'extended', 'extended'])
  })

  it('«ладонь из круга» выносит ладонь вверх дальше радиуса круга и возвращает', () => {
    const c = clips.find((x) => x.name === 'palm-move')!
    const ys = Array.from({ length: c.count }, (_, i) => c.move[i * 3 + 1])
    expect(Math.max(...ys)).toBeGreaterThan(c.ring)
    expect(Math.abs(ys[0])).toBeLessThan(0.005)
  })
})

describe('формат клипа', () => {
  it('JSON туда и обратно — точность до шага квантования', () => {
    const c = clips.find((x) => x.name === 'palm-move')!
    const back = decodeClip(JSON.parse(JSON.stringify(encodeClip(c))))
    expect(back.count).toBe(c.count)
    expect(back.ring).toBeCloseTo(c.ring)
    for (let i = 0; i < c.points.length; i++) expect(Math.abs(back.points[i] - c.points[i])).toBeLessThanOrEqual(0.00026)
    for (let i = 0; i < c.move.length; i++) expect(Math.abs(back.move[i] - c.move[i])).toBeLessThanOrEqual(0.00026)
  })

  it('клип без сдвига не пишет move — файл меньше', () => {
    const still = makeClip('still', 'right', 30, [poseHand(OPEN_POSE, 'right')])
    expect(encodeClip(still).move).toBeUndefined()
  })

  it('выборка кадра: посередине — среднее, после конца — снова начало', () => {
    const a = new Float32Array(FRAME_LEN)
    const b = new Float32Array(FRAME_LEN).fill(1)
    const c = makeClip('ab', 'right', 10, [a, b], [[0, 0, 0], [0, 1, 0]])
    const out = new Float32Array(FRAME_LEN)
    const mv = new Float32Array(3)
    sampleClip(c, 0.05, out, mv)
    expect(out[7]).toBeCloseTo(0.5)
    expect(mv[1]).toBeCloseTo(0.5)
    // Последний кадр плавно уходит в первый: на 0.15 с — середина пути b → a.
    sampleClip(c, 0.15, out, mv)
    expect(out[7]).toBeCloseTo(0.5)
    sampleClip(c, 0.2, out, mv)
    expect(out[7]).toBeCloseTo(0)
    sampleClip(c, -0.05, out, mv)
    expect(out[7]).toBeCloseTo(0.5)
  })
})

describe('запись живой руки', () => {
  /** Поза процедурной руки в координатах трекера — как будто её записала камера. */
  const trackerWorld = toTracker(poseHand(OPEN_POSE, 'right'))

  it('неровные кадры трекера → ровные 30 к/с; форма руки в осях клипа, сдвиг ладони в метрах', () => {
    // Ладонь на картинке поднимается на 0.1 высоты кадра; ладонь (запястье → основание среднего) на картинке — 0.2.
    const samples: RecordedSample[] = [0, 0.04, 0.07, 0.11, 0.15, 0.2, 0.24, 0.3].map((t, i, all) => ({
      t: 10 + t,
      world: trackerWorld,
      palm: { x: 0.6, y: 0.5 - (0.1 * i) / (all.length - 1), z: 0 },
      size: 0.2,
    }))
    const c = recordingToClip(samples, 'palm-raise', 'right', 4 / 3)
    expect(c.count).toBe(9)
    expect(c.fps).toBe(30)
    // Точки вернулись в оси клипа (y вверх, z к зрителю) — совпадают с исходной позой.
    const pose = poseHand(OPEN_POSE, 'right')
    for (let i = 0; i < FRAME_LEN; i++) expect(c.points[i]).toBeCloseTo(pose[i], 5)
    // 0.1 высоты кадра при ладони 0.2 = половина ладони (~4.5 см) вверх.
    const palmM = dist(pt(pose, 0), pt(pose, 9))
    expect(c.move[(c.count - 1) * 3 + 1]).toBeCloseTo(palmM / 2, 4)
    expect(c.move[1]).toBeCloseTo(0, 6)
  })
})
