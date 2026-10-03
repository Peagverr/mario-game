import { describe, expect, it } from 'vitest'
import { CONFIRM_FRAMES, HandConfirm, insideFaceRatio, isFaceGhost, nearFace, type FaceOval, type Pt } from './ghostHands'

const FACE: FaceOval = { cx: 0.66, cy: 0.4, rx: 0.15, ry: 0.2 }
/** 21 точка «руки» вокруг центра с разбросом r. */
const hand = (cx: number, cy: number, r = 0.06): Pt[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: cx + Math.cos(i) * r, y: cy + Math.sin(i * 1.3) * r }))

describe('руки-призраки на лице', () => {
  it('рука прямо на лице — призрак, рука справа от лица (джойстик) — настоящая', () => {
    expect(isFaceGhost(hand(0.66, 0.4), FACE, 0)).toBe(true)
    expect(isFaceGhost(hand(1.0, 0.45), FACE, 0)).toBe(false)
  })

  it('ладонь у края лица не отбрасывается; при быстром движении головы порог строже', () => {
    const edge = hand(FACE.cx + FACE.rx, 0.4, 0.07) // центр ладони на краю овала — около половины точек на лице
    const r = insideFaceRatio(edge, FACE)
    expect(r).toBeGreaterThan(0.4)
    expect(r).toBeLessThan(0.6)
    expect(isFaceGhost(edge, FACE, 0)).toBe(false)
    expect(isFaceGhost(edge, FACE, 3)).toBe(false)
    // глубже на лице: в покое ещё рука, при быстром движении головы — уже призрак
    const deeper = hand(FACE.cx + FACE.rx * 0.7, 0.4, 0.07)
    const rd = insideFaceRatio(deeper, FACE)
    expect(rd).toBeGreaterThan(0.55)
    expect(rd).toBeLessThan(0.7)
    expect(isFaceGhost(deeper, FACE, 0)).toBe(false)
    expect(isFaceGhost(deeper, FACE, 3)).toBe(true)
  })

  it('без лица ничего не отбрасываем', () => {
    expect(isFaceGhost(hand(0.66, 0.4), null, 5)).toBe(false)
  })

  it('новая рука принимается после нескольких кадров подряд; мигание сбрасывает счёт', () => {
    const c = new HandConfirm()
    for (let i = 1; i < CONFIRM_FRAMES; i++) expect(c.update(true)).toBe(false)
    expect(c.update(true)).toBe(true)
    expect(c.update(true)).toBe(true)
    expect(c.update(false)).toBe(false)
    expect(c.update(true)).toBe(false)
  })

  it('рука вдали от лица принимается сразу — после рывка управление не ждёт', () => {
    const c = new HandConfirm()
    expect(c.update(true, false)).toBe(true)
    expect(nearFace(hand(1.4, 0.5), FACE)).toBe(false)
    expect(nearFace(hand(0.8, 0.45), FACE)).toBe(true)
  })
})
