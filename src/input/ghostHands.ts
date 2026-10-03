/**
 * Защита от «рук-призраков» на лице. MediaPipe при быстром движении головы иногда принимает лицо за ладонь:
 * рука появляется прямо на лице, то левая, то правая, и герой дёргается сам.
 * Два фильтра (оба по координатам кадра в «квадратных» единицах, как в tracker.ts):
 *  1) рука, чьи точки в основном лежат внутри овала лица, — не рука (лицо распознаётся отдельно и надёжно);
 *     когда голова движется быстро, порог строже — призраки появляются именно тогда;
 *  2) новая рука принимается, только если её видно несколько кадров подряд — призраки мелькают на 1–2 кадра.
 *     Уже найденная рука не ждёт: ведение героя не запаздывает.
 */

export type Pt = { x: number; y: number }
/** Овал лица: центр и полуоси (в квадратных координатах кадра). */
export type FaceOval = { cx: number; cy: number; rx: number; ry: number }

/** Доля точек руки внутри овала лица: 0 — рука снаружи, 1 — целиком на лице. */
export function insideFaceRatio(points: Pt[], f: FaceOval) {
  if (!points.length) return 0
  let n = 0
  for (const p of points) {
    const dx = (p.x - f.cx) / f.rx
    const dy = (p.y - f.cy) / f.ry
    if (dx * dx + dy * dy < 1) n++
  }
  return n / points.length
}

/** Обычно — призрак, если на лице больше 70% точек (призрак лежит на лице почти целиком; ладонь-джойстик у края — около половины). */
export const FACE_GHOST_RATIO = 0.7
/** Голова движется быстро (ширин лица в секунду) — порог строже. */
export const FAST_FACE_SPEED = 1.5
export const FACE_GHOST_RATIO_FAST = 0.55
/** Сколько кадров подряд надо видеть новую руку. */
export const CONFIRM_FRAMES = 3

export function isFaceGhost(points: Pt[], face: FaceOval | null, faceSpeed: number) {
  if (!face) return false
  const limit = faceSpeed > FAST_FACE_SPEED ? FACE_GHOST_RATIO_FAST : FACE_GHOST_RATIO
  return insideFaceRatio(points, face) > limit
}

/** Подтверждение новой руки: true, когда руку можно отдавать игре. */
export class HandConfirm {
  private streak = 0
  private accepted = false
  update(seen: boolean) {
    if (!seen) {
      this.streak = 0
      this.accepted = false
      return false
    }
    this.streak++
    if (this.streak >= CONFIRM_FRAMES) this.accepted = true
    return this.accepted
  }
}
