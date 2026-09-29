import type { HandState, Hint, HintCode, MoveScheme } from '../shared/controlState'
import { FINGER_NAMES, FINGER_POINTS, PINCH_OFF, PINCH_ON, POINT_MIN_LEN } from './gestures'

/**
 * «Режим ошибки»: замечаем движения, которые ПОЧТИ правильные, и говорим, что конкретно исправить.
 *
 * Два шага:
 * 1) detectCandidates — чистые правила: что не так прямо сейчас в этом кадре;
 * 2) HintFilter — показывает подсказку, только если проблема держится дольше порога
 *    (переходы между жестами длятся ~0.2 с и не должны вызывать подсказки), и не даёт им мигать.
 */

/** Средняя длина ладони взрослого (запястье → основание среднего пальца), мм. Для «осталось N мм». */
const HAND_SIZE_MM = 95

export type ErrorContext = {
  left: HandState | null
  right: HandState | null
  head: { z: number; visible: boolean; yawDeg: number }
  brightness: number
  /** Смещение правой ладони от «нулевой точки» джойстика, в долях рабочей зоны (1 = край зоны). */
  joystickReach: number
  /** Схема ходьбы: от неё зависят подсказки для правой руки. */
  scheme: MoveScheme
  /** Сколько мс нет ни одной руки. */
  noHandsMs: number
  /** Сколько мс нет лица. */
  noFaceMs: number
  /** Сколько мс в кадре только левая раскрытая ладонь (без правой). */
  onlyLeftMs: number
  /** Сколько мс назад левая рука пропала посреди щипка (0 — не пропадала). */
  leftLostWhilePinchMs: number
  /** Нужны ли сейчас руки (идёт игра или обучение). */
  wantsHands: boolean
}

function fingersList(idx: number[]) {
  return idx.map((i) => FINGER_NAMES[i]).join(', ')
}

function edgeHint(hand: HandState, side: 'left' | 'right'): Hint | null {
  const m = 0.025
  let minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const p of hand.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const who = side === 'right' ? 'Правая рука' : 'Левая рука'
  if (minX < m) return { code: 'hand-edge', hand: side, arrow: 'right', text: `${who} уходит за левый край кадра — сдвинь её правее` }
  if (maxX > 1 - m) return { code: 'hand-edge', hand: side, arrow: 'left', text: `${who} уходит за правый край кадра — сдвинь её левее` }
  if (maxY > 1 - m) return { code: 'hand-edge', hand: side, arrow: 'up', text: `${who} слишком низко — подними её выше, в центр кадра` }
  if (minY < m) return { code: 'hand-edge', hand: side, arrow: 'down', text: `${who} слишком высоко — опусти её ниже` }
  return null
}

export function detectCandidates(c: ErrorContext): Hint[] {
  const out: Hint[] = []

  // — Окружение и положение человека —
  if (c.brightness < 0.16) {
    out.push({ code: 'dark', text: 'Слишком темно — включи свет или повернись лицом к окну' })
  }
  if (c.noFaceMs > 900) {
    out.push({ code: 'no-face', text: 'Не вижу лицо — сядь прямо напротив камеры' })
  } else if (c.head.visible) {
    if (c.head.z < 0.33) {
      const cm = Math.round((0.5 - c.head.z) * 100)
      out.push({ code: 'too-close', arrow: 'farther', text: `Слишком близко к экрану — отодвинься примерно на ${cm} см` })
    } else if (c.head.z > 1.15) {
      const cm = Math.round((c.head.z - 0.75) * 100)
      out.push({ code: 'too-far', arrow: 'closer', text: `Далеко от камеры — подвинься ближе примерно на ${cm} см` })
    }
    if (Math.abs(c.head.yawDeg) > 32) {
      out.push({ code: 'head-turned', text: 'Голова повёрнута в сторону — повернись лицом к экрану. Двигай головой, а не поворачивай её' })
    }
  }

  if (!c.wantsHands) return out

  if (c.noHandsMs > 1500) {
    out.push({
      code: 'no-hands',
      hand: 'right',
      text: c.scheme === 'palm'
        ? 'Подними правую ладонь перед камерой на уровне груди — это джойстик героя'
        : 'Подними правую руку на уровень груди и вытяни указательный палец',
    })
  }

  // Рука пропала прямо во время щипка — почти всегда её повернули ребром: так камера ладонь не видит.
  if (c.leftLostWhilePinchMs > 250 && c.leftLostWhilePinchMs < 4000) {
    out.push({ code: 'hand-turned', hand: 'left', text: 'Боком камера руку не видит — поверни левую ладонь к камере, можно наискосок' })
  }

  if (c.onlyLeftMs > 1200) {
    out.push({ code: 'wrong-hand', hand: 'left', text: 'Ходьба — правой рукой. Левой делай щипок, чтобы повернуть мир' })
  }

  // — Правая рука: джойстик и прыжок —
  const r = c.right
  if (r) {
    const edge = edgeHint(r, 'right')
    if (edge) out.push(edge)

    const nonThumb = r.curls.slice(1)
    const curledCount = nonThumb.filter((s) => s === 'curled').length
    const othersExtended = [2, 3, 4].filter((i) => r.curls[i] === 'extended')
    const othersCurled = [2, 3, 4].every((i) => r.curls[i] === 'curled')

    if (c.scheme !== 'palm' && !r.fist && !r.openPalm) {
      if (r.curls[1] === 'extended' && othersExtended.length >= 2) {
        // Показывает пальцем, но остальные пальцы тоже выпрямлены.
        out.push({
          code: 'point-partial',
          hand: 'right',
          landmarks: othersExtended.flatMap((i) => FINGER_POINTS[i]),
          text: `Чтобы идти, оставь выпрямленным только указательный — согни ${fingersList(othersExtended)}`,
        })
      } else if (r.curls[1] === 'half' && othersCurled) {
        out.push({
          code: 'point-partial',
          hand: 'right',
          landmarks: FINGER_POINTS[1],
          text: 'Указательный согнут наполовину: выпрями его — идти, согни полностью — прыжок',
        })
      } else if (c.scheme === 'pointer' && r.pointing && r.pointLen < POINT_MIN_LEN) {
        out.push({
          code: 'point-camera',
          hand: 'right',
          landmarks: FINGER_POINTS[1],
          text: 'Палец смотрит прямо в камеру — наклони его туда, куда идти: вверх — вперёд, в сторону — вбок',
        })
      }
    }

    // Кулак почти собран: часть пальцев согнута, часть нет (но это не попытка показать пальцем).
    const pointAttempt = r.curls[1] !== 'curled' && othersCurled
    if (!r.fist && !r.pointing && !pointAttempt && curledCount >= 2 && curledCount <= 3) {
      const notCurled = [1, 2, 3, 4].filter((i) => r.curls[i] !== 'curled')
      out.push({
        code: 'fist-partial',
        hand: 'right',
        landmarks: notCurled.flatMap((i) => FINGER_POINTS[i]),
        text: `Чтобы прыгнуть, сожми кулак полностью — не согнут${notCurled.length > 1 ? 'ы' : ''}: ${fingersList(notCurled)}`,
      })
    }

    if (c.scheme !== 'pointer' && c.joystickReach > 1.8) {
      out.push({ code: 'joystick-far', hand: 'right', text: 'Рука слишком далеко от центра — для бега хватит небольшого сдвига ладони' })
    }
  }

  // — Левая рука: щипок —
  const l = c.left
  if (l) {
    const edge = edgeHint(l, 'left')
    if (edge && !out.some((h) => h.code === 'hand-edge')) out.push(edge)

    if (!l.pinching && l.pinchRatio > PINCH_OFF && l.pinchRatio < 0.75 && l.curls[1] !== 'curled') {
      const mm = Math.max(5, Math.round((l.pinchRatio - PINCH_ON) * HAND_SIZE_MM))
      out.push({
        code: 'pinch-partial',
        hand: 'left',
        landmarks: [3, 4, 7, 8],
        text: `Сведи большой и указательный плотнее — осталось примерно ${mm} мм`,
      })
    }
  }

  return out
}

/** Сколько проблема должна держаться, прежде чем показать подсказку (мс). */
const HOLD_MS: Record<HintCode, number> = {
  'no-face': 0,
  'too-close': 700,
  'too-far': 900,
  'head-turned': 900,
  dark: 1200,
  'hand-edge': 350,
  'fist-partial': 450,
  'pinch-partial': 550,
  'joystick-far': 700,
  'wrong-hand': 0,
  'no-hands': 0,
  'hand-turned': 0,
  'point-partial': 500,
  'point-camera': 600,
}

/** Порядок важности: сначала то, без чего ничего не работает. */
const PRIORITY: HintCode[] = [
  'dark', 'no-face', 'too-close', 'too-far', 'hand-turned', 'no-hands', 'wrong-hand',
  'hand-edge', 'point-partial', 'point-camera', 'fist-partial', 'pinch-partial', 'joystick-far', 'head-turned',
]

const MIN_VISIBLE_MS = 1600
const MAX_HINTS = 2

export class HintFilter {
  private since = new Map<HintCode, number>()
  private visible = new Map<HintCode, { hint: Hint; until: number }>()

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
      } else if (heldFor >= HOLD_MS[h.code]) {
        this.visible.set(h.code, { hint: h, until: t + MIN_VISIBLE_MS })
        appeared.push(h.code)
      }
    }

    for (const [code, v] of this.visible) if (v.until < t) this.visible.delete(code)

    const hints = [...this.visible.values()]
      .map((v) => v.hint)
      .sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code))
      .slice(0, MAX_HINTS)
    return { hints, appeared }
  }

  reset() {
    this.since.clear()
    this.visible.clear()
  }
}

/** Короткие советы для разбора ошибок на экране итогов. */
export const ERROR_ADVICE: Record<HintCode, { title: string; tip: string }> = {
  'fist-partial': { title: 'Неполный кулак', tip: 'Сжимай все четыре пальца разом — как будто хватаешь ручку.' },
  'pinch-partial': { title: 'Неплотный щипок', tip: 'Соединяй подушечки большого и указательного до касания.' },
  'hand-edge': { title: 'Рука у края кадра', tip: 'Держи руки ближе к груди, в центре кадра.' },
  'joystick-far': { title: 'Слишком большой замах', tip: 'Для бега хватает сдвига ладони на пару сантиметров.' },
  'wrong-hand': { title: 'Не та рука', tip: 'Правая — ходьба и прыжок, левая — поворот мира.' },
  'no-hands': { title: 'Руки вне кадра', tip: 'Держи правую ладонь поднятой на уровне груди.' },
  'no-face': { title: 'Лицо вне кадра', tip: 'Сядь напротив камеры, чтобы работал эффект окна.' },
  'too-close': { title: 'Слишком близко', tip: 'Лучшее расстояние — 50–70 см от экрана.' },
  'too-far': { title: 'Слишком далеко', tip: 'Лучшее расстояние — 50–70 см от экрана.' },
  'head-turned': { title: 'Голова повёрнута', tip: 'Смотри на экран прямо — двигай головой, а не поворачивай её.' },
  dark: { title: 'Мало света', tip: 'Свет должен падать на лицо и руки, а не из-за спины.' },
  'hand-turned': { title: 'Рука ребром к камере', tip: 'Держи ладонь к камере или наискосок — ребром её не видно.' },
  'point-partial': { title: 'Неточное указание', tip: 'Выпрями только указательный, остальные пальцы прижми к ладони.' },
  'point-camera': { title: 'Палец в камеру', tip: 'Показывай пальцем вверх или в сторону, а не прямо в камеру.' },
}
