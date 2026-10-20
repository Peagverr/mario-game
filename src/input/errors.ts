import type { CameraStatus, HandState, Hint, HintCode } from '../shared/controlState'
import { t } from '../i18n'
import { FINGER_POINTS } from './gestures'

/**
 * «Режим ошибки»: замечаем движения, которые ПОЧТИ правильные, и говорим, что конкретно исправить.
 *
 * Два шага:
 * 1) detectCandidates — чистые правила: что не так прямо сейчас в этом кадре;
 * 2) HintFilter — показывает подсказку, только если проблема держится дольше порога
 *    (переходы между жестами длятся ~0.2 с и не должны вызывать подсказки), не даёт им мигать и не пристаёт:
 *    на экране одна подсказка, а ушедшая не возвращается несколько секунд.
 */

/** Кадр темнее этого — не «темно в комнате», а закрытая камера (шторка, чужая программа). */
export const BLACK_FRAME = 0.03

export type ErrorContext = {
  /** Что с камерой (см. control.tracking.camera). */
  camera: CameraStatus
  left: HandState | null
  right: HandState | null
  head: { z: number; visible: boolean; yawDeg: number }
  brightness: number
  /** Сколько мс нет ни одной руки. */
  noHandsMs: number
  /** Сколько мс нет лица. */
  noFaceMs: number
  /** Сколько мс в кадре только левая раскрытая ладонь (без правой). */
  onlyLeftMs: number
  /** Сколько мс назад левая рука пропала посреди хвата левым кулаком (0 — не пропадала). */
  leftLostWhileGrabMs: number
  /** Сколько мс правая рука видна, но ещё не заходила в центр кольца (0 — зашла или руки нет). */
  palmUnarmedMs: number
  /** Нужны ли сейчас руки (идёт игра или обучение). */
  wantsHands: boolean
  /** Идёт обучение: только тут напоминаем «подними руку» — в игре опущенные руки значат отдых. */
  inTutorial: boolean
}


function edgeHint(hand: HandState, side: 'left' | 'right'): Hint | null {
  const m = 0.025
  let minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const p of hand.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const s = t().hints
  const who = side === 'right' ? s.rightHand : s.leftHand
  if (minX < m) return { code: 'hand-edge', hand: side, arrow: 'right', text: s.edgeLeft(who) }
  if (maxX > 1 - m) return { code: 'hand-edge', hand: side, arrow: 'left', text: s.edgeRight(who) }
  if (maxY > 1 - m) return { code: 'hand-edge', hand: side, arrow: 'up', text: s.edgeLow(who) }
  if (minY < m) return { code: 'hand-edge', hand: side, arrow: 'down', text: s.edgeHigh(who) }
  return null
}

export function detectCandidates(c: ErrorContext): Hint[] {
  const s = t().hints
  // Камера не присылает кадры или чёрный кадр — причина всего остального («не вижу лицо», «подними руку»):
  // говорим только о ней.
  if (c.camera === 'frozen' || c.camera === 'ended') {
    return [{ code: 'camera-lost', text: s.cameraLost }]
  }
  if (c.camera === 'black' || c.brightness < BLACK_FRAME) {
    return [{ code: 'camera-blocked', text: s.cameraBlocked }]
  }

  const out: Hint[] = []

  // — Окружение и положение человека —
  if (c.brightness < 0.16) {
    out.push({ code: 'dark', text: s.dark })
  }
  if (c.noFaceMs > 900) {
    out.push({ code: 'no-face', text: s.noFace })
  } else if (c.head.visible) {
    if (c.head.z < 0.33) {
      const cm = Math.round((0.5 - c.head.z) * 100)
      out.push({ code: 'too-close', arrow: 'farther', text: s.tooClose(cm) })
    } else if (c.head.z > 1.15) {
      const cm = Math.round((c.head.z - 0.75) * 100)
      out.push({ code: 'too-far', arrow: 'closer', text: s.tooFar(cm) })
    }
    if (Math.abs(c.head.yawDeg) > 32) {
      out.push({ code: 'head-turned', text: s.headTurned })
    }
  }

  if (!c.wantsHands) return out

  if (c.inTutorial && c.noHandsMs > 1500) {
    out.push({ code: 'no-hands', hand: 'right', text: s.noHands })
  }

  // Левая рука пропала прямо во время хвата — почти всегда её повернули ребром или увели из кадра.
  if (c.leftLostWhileGrabMs > 250 && c.leftLostWhileGrabMs < 4000) {
    out.push({ code: 'hand-turned', hand: 'left', text: s.handTurned })
  }

  if (c.onlyLeftMs > 1200) {
    out.push({ code: 'wrong-hand', hand: 'left', text: s.wrongHand })
  }

  // — Правая рука: ладонь-джойстик и прыжок —
  const r = c.right
  if (r) {
    const edge = edgeHint(r, 'right')
    if (edge) out.push(edge)

    // Кулак почти собран: часть пальцев согнута, часть нет.
    const curledCount = r.curls.slice(1).filter((s) => s === 'curled').length
    if (!r.fist && curledCount >= 2 && curledCount <= 3) {
      const notCurled = [1, 2, 3, 4].filter((i) => r.curls[i] !== 'curled')
      out.push({
        code: 'fist-partial',
        hand: 'right',
        landmarks: notCurled.flatMap((i) => FINGER_POINTS[i]),
        text: s.fistPartial(notCurled.map((i) => s.fingers[i])),
      })
    }

    // Рука видна, а в круг не заходила — герой её не слушается, и игрок может не понять почему.
    if (c.palmUnarmedMs > 1500) {
      out.push({
        code: 'palm-not-armed',
        hand: 'right',
        text: s.palmNotArmed,
      })
    }
  }

  // — Левая рука: кулак держит мир. Отдельной подсказки для него нет: кулак распознаётся уверенно. —
  const l = c.left
  if (l) {
    const edge = edgeHint(l, 'left')
    if (edge && !out.some((h) => h.code === 'hand-edge')) out.push(edge)
  }

  return out
}

/** Сколько проблема должна держаться, прежде чем показать подсказку (мс). */
const HOLD_MS: Record<HintCode, number> = {
  // Первые кадры камеры бывают чёрными — не пугаем зря.
  'camera-blocked': 1000,
  // Замершую камеру распознавание и так ждёт секунду, прежде чем сказать «кадры не идут».
  'camera-lost': 0,
  'no-face': 0,
  'too-close': 700,
  'too-far': 900,
  'head-turned': 900,
  dark: 1200,
  'hand-edge': 350,
  'fist-partial': 450,
  'wrong-hand': 0,
  'no-hands': 0,
  'hand-turned': 0,
  // Длительность уже учтена в palmUnarmedMs.
  'palm-not-armed': 0,
}

/** Порядок важности: сначала то, без чего ничего не работает. */
const PRIORITY: HintCode[] = [
  'camera-lost', 'camera-blocked', 'dark', 'no-face', 'too-close', 'too-far', 'hand-turned', 'no-hands', 'wrong-hand',
  'hand-edge', 'palm-not-armed', 'fist-partial', 'head-turned',
]

const MIN_VISIBLE_MS = 1600
/** На экране одна подсказка — самая важная. */
const MAX_HINTS = 1
/** Подсказка ушла — та же не возвращается столько мс, даже если ошибка повторилась: не пристаём. */
const COOLDOWN_MS = 8000

export class HintFilter {
  private since = new Map<HintCode, number>()
  private visible = new Map<HintCode, { hint: Hint; until: number }>()
  private cooldownUntil = new Map<HintCode, number>()

  /** Возвращает подсказки к показу и коды, которые только что появились (их засчитываем как ошибку). */
  update(candidates: Hint[], t: number): { hints: Hint[]; appeared: HintCode[] } {
    const appeared: HintCode[] = []
    const present = new Set(candidates.map((h) => h.code))

    for (const code of [...this.since.keys()]) if (!present.has(code)) this.since.delete(code)

    for (const h of candidates) {
      if (!this.since.has(h.code)) this.since.set(h.code, t)
      const heldFor = t - (this.since.get(h.code) ?? t)
      const shown = this.visible.get(h.code)
      if (shown) {
        shown.hint = h // обновляем текст (например, «осталось 12 мм» → «8 мм»)
        shown.until = t + MIN_VISIBLE_MS
      } else if (heldFor >= HOLD_MS[h.code] && t >= (this.cooldownUntil.get(h.code) ?? 0)) {
        this.visible.set(h.code, { hint: h, until: t + MIN_VISIBLE_MS })
        appeared.push(h.code)
      }
    }

    for (const [code, v] of this.visible) {
      if (v.until >= t) continue
      this.visible.delete(code)
      this.cooldownUntil.set(code, t + COOLDOWN_MS)
    }

    const hints = [...this.visible.values()]
      .map((v) => v.hint)
      .sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code))
      .slice(0, MAX_HINTS)
    return { hints, appeared }
  }

  reset() {
    this.since.clear()
    this.visible.clear()
    this.cooldownUntil.clear()
  }
}

/** Короткие советы для разбора ошибок на экране итогов (тексты в src/i18n.ts). */
export const errorAdvice = (code: HintCode) => t().advice[code]
