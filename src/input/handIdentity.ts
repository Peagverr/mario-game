/**
 * Какая рука левая, а какая правая — с памятью.
 *
 * MediaPipe называет руку заново в каждом кадре и для кулака часто ошибается. Поэтому сторону решаем,
 * когда рука появилась, а дальше узнаём руку по тому, что она движется непрерывно: из кадра в кадр рука
 * сдвигается немного, и ближайшая к тому месту, где она должна быть (с учётом её скорости), — та же самая.
 * Так держат объекты трекеры вроде SORT. Где рука относительно головы, уже не важно.
 *
 * Голоса за сторону, от сильного к слабому:
 * 1) поза тела (если видны плечи): рука принадлежит той руке тела, к запястью которой ближе, —
 *    это работает и для кулака, и когда руку подняли сразу с «чужой» стороны головы;
 * 2) память: рука пропала недавно и появилась там, где её ждали, — это она же;
 * 3) метка MediaPipe (про кулак — слабо) и положение относительно лица.
 *
 * Узнанную руку меняем, только если поза или (для раскрытой ладони) метка долго и уверенно говорят обратное.
 *
 * Координаты «квадратные», как в tracker.ts: x·(ширина/высота кадра), y — доли высоты кадра, зеркально.
 */

export type Side = 'left' | 'right'
export type Pt = { x: number; y: number }
/** Лицо: центр между зрачками и ширина от скулы до скулы (квадратные координаты). */
export type FaceRef = { x: number; y: number; w: number }
/** Запястья по позе тела: left — левой руки игрока (её плечо слева на экране). null — не видно. */
export type ArmRef = { left: Pt | null; right: Pt | null }

export type HandSeen = {
  /** Центр ладони. */
  x: number
  y: number
  /** Запястье и размер ладони (запястье → основание среднего пальца) — для сравнения с позой. */
  wrist?: Pt
  size?: number
  /** Что сказал MediaPipe (null — ничего). */
  label: Side | null
  /** Уверенность MediaPipe в метке, 0.5..1. */
  score: number
  /** Встроенный жест «кулак»: по кулаку MediaPipe левую и правую различает плохо. */
  fist: boolean
}

type Track = {
  x: number
  y: number
  /** Скорость (доли высоты кадра в мс) — чтобы знать, где рука будет, если её на миг потеряли. */
  vx: number
  vy: number
  t: number
  born: number
  frames: number
  vote: number
  doubt: number
}

const SIDES: Side[] = ['left', 'right']
/** Руку потеряли — столько мс узнаём её, если она появится там, где её ждали. */
export const KEEP_MS = 500
/** Насколько рука может отойти от ожидаемого места (доли высоты кадра)… */
const GATE = 0.18
/** …и сколько ещё за каждую мс, пока её не видели. */
const GATE_PER_MS = 0.0012
/** Дальше этого (мс) движение руки не продолжаем: рука тормозит, а не летит по прямой. */
const PREDICT_MS = 300
/** Рука, которую видели меньше кадров, пропала — забываем сразу (это мог быть призрак). */
const ESTABLISHED_FRAMES = 3
/** Первые мс новой руки: сторону ещё можно поправить, если голоса поменялись. */
export const YOUNG_MS = 200
/** Поза или метка спорят со стороной столько «секунд × уверенность» — меняем сторону. */
const FLIP_DOUBT = 0.6
/** Метку ниже этой уверенности в споре не слушаем. */
const DOUBT_SCORE = 0.8
/** Голос положения: на столько ширин лица правее лица — полный голос «правая». */
const POS_FACE_WIDTHS = 0.8
const POS_WEIGHT = 0.8
/** Голос метки для кулака слабее. */
const FIST_LABEL_WEIGHT = 0.3
/** Рука пропала недавно (мс) и появилась рядом с ожидаемым местом (доли высоты кадра) — скорее всего, она же. */
const MEMORY_MS = 2000
const MEMORY_RADIUS = 0.25
const MEMORY_WEIGHT = 1.5
/** Поза: запястье руки ближе стольких размеров ладони к запястью руки тела — это она. */
const ARM_NEAR = 2
/** Насколько одно запястье тела должно быть ближе другого (в размерах ладони) для полного голоса. */
const ARM_MARGIN = 1.5
/** Видно одно запястье тела, а рука дальше стольких размеров ладони от него — значит, это другая рука. */
const ARM_FAR = 4
const ARM_WEIGHT = 2.5
/** Поза так уверенно, что её одной хватает поспорить с узнанной рукой. */
const ARM_SURE = ARM_WEIGHT * 0.6

const sign = (s: Side) => (s === 'right' ? 1 : -1)
const other = (s: Side): Side => (s === 'right' ? 'left' : 'right')
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Где рука должна быть сейчас: последнее место плюс её движение (не дальше PREDICT_MS). */
function predicted(tr: Track, t: number): Pt {
  const dt = Math.min(PREDICT_MS, Math.max(0, t - tr.t))
  return { x: tr.x + tr.vx * dt, y: tr.y + tr.vy * dt }
}

/** Насколько рука далеко от того, где её ждали: от ожидаемого места или от последнего — что ближе. */
function miss(h: Pt, tr: Track, t: number) {
  return Math.min(dist(h, predicted(tr, t)), dist(h, tr))
}

export class HandIdentity {
  private tracks: Record<Side, Track | null> = { left: null, right: null }

  /** Узнать руки этого кадра. Стороны — в том же порядке, что hands (null — лишняя рука, не берём). */
  assign(hands: HandSeen[], t: number, face: FaceRef | null, aspect: number, arms: ArmRef | null = null): (Side | null)[] {
    const out: (Side | null)[] = hands.map(() => null)
    const ctx = { t, face, aspect, arms }

    // 1) Узнаём руки по месту: из всех пар «рука — прошлая рука» берём больше всего совпадений, потом ближе.
    const pick = this.match(hands, t)
    for (const p of pick) out[p.i] = p.side

    // 2) Новые руки.
    const fresh = hands.map((_, i) => i).filter((i) => out[i] === null)
    const taken = new Set(pick.map((p) => p.side))
    if (fresh.length >= 2 && taken.size === 0) {
      // Две новые сразу: та, за которую голосов «правая» больше, — правая (обычно это правее на экране).
      const [a, b] = fresh
      const va = this.vote(hands[a], ctx) + hands[a].x * 0.01
      const vb = this.vote(hands[b], ctx) + hands[b].x * 0.01
      out[va > vb ? a : b] = 'right'
      out[va > vb ? b : a] = 'left'
    } else {
      for (const i of fresh) {
        const free = SIDES.filter((s) => !taken.has(s))
        if (!free.length) break
        const side = free.length === 1 ? free[0] : this.vote(hands[i], ctx) > 0 ? 'right' : 'left'
        out[i] = side
        taken.add(side)
      }
    }

    // 3) Обновляем память.
    const matched: { side: Side; i: number; dt: number }[] = []
    for (const side of SIDES) {
      const i = out.indexOf(side)
      const tr = this.tracks[side]
      if (i < 0) {
        // Не видно: недолго видимую руку забываем сразу, остальные помним KEEP_MS (и MEMORY_MS — где пропала).
        if (tr && tr.frames < ESTABLISHED_FRAMES) this.tracks[side] = null
        continue
      }
      const h = hands[i]
      if (!pick.some((p) => p.side === side && p.i === i)) {
        this.tracks[side] = { x: h.x, y: h.y, vx: 0, vy: 0, t, born: t, frames: 1, vote: this.vote(h, ctx), doubt: 0 }
        continue
      }
      const gap = t - tr!.t
      // Скорость — сглаженная и только по соседним кадрам: после долгой потери прыжок — не скорость.
      if (gap > 0 && gap < 100) {
        tr!.vx += ((h.x - tr!.x) / gap - tr!.vx) * 0.5
        tr!.vy += ((h.y - tr!.y) / gap - tr!.vy) * 0.5
      } else if (gap >= 100) {
        tr!.vx = 0
        tr!.vy = 0
      }
      Object.assign(tr!, { x: h.x, y: h.y, t, frames: tr!.frames + 1 })
      matched.push({ side, i, dt: Math.min(0.1, gap / 1000) })
    }
    // Сторону пересматриваем, когда память уже обновлена: смена стороны переносит руку на другую сторону.
    for (const m of matched) this.reconsider(m.side, hands[m.i], m.dt, ctx, out, m.i)
    this.swapIfBothWrong(out)
    return out
  }

  /**
   * Нужна ли сейчас поза тела: в кадре рука, которую ещё не узнали, или рука только что появилась.
   * Позу считать дорого — в остальное время хватает редких проверок.
   */
  needsArms(hands: HandSeen[], t: number) {
    if (SIDES.some((s) => this.tracks[s] && t - this.tracks[s]!.born < YOUNG_MS)) return true
    return this.match(hands, t).length < hands.length
  }

  /** Камера пропала или перезапуск — всё забыть. */
  reset() {
    this.tracks = { left: null, right: null }
  }

  private match(hands: HandSeen[], t: number) {
    const live = SIDES.filter((s) => {
      const tr = this.tracks[s]
      return tr && t - tr.t < KEEP_MS
    })
    const pairs: { i: number; side: Side; d: number }[] = []
    hands.forEach((h, i) => {
      for (const side of live) {
        const tr = this.tracks[side]!
        const d = miss(h, tr, t)
        if (d < GATE + GATE_PER_MS * (t - tr.t)) pairs.push({ i, side, d })
      }
    })
    let pick: typeof pairs = []
    let pickCost = Infinity
    for (let mask = 1; mask < 1 << pairs.length; mask++) {
      const set = pairs.filter((_, k) => mask & (1 << k))
      if (new Set(set.map((p) => p.i)).size < set.length || new Set(set.map((p) => p.side)).size < set.length) continue
      const cost = set.reduce((a, p) => a + p.d, 0)
      if (set.length > pick.length || (set.length === pick.length && cost < pickCost)) {
        pick = set
        pickCost = cost
      }
    }
    return pick
  }

  /** Голос позы: >0 — рука на правой руке тела, <0 — на левой, 0 — поза не знает. */
  private armVote(h: HandSeen, arms: ArmRef | null) {
    if (!arms || (!arms.left && !arms.right)) return 0
    const w = h.wrist ?? h
    const size = Math.max(h.size ?? 0.15, 0.05)
    const dl = arms.left ? dist(w, arms.left) / size : Infinity
    const dr = arms.right ? dist(w, arms.right) / size : Infinity
    const near = Math.min(dl, dr)
    const far = Math.max(dl, dr)
    if (near <= ARM_NEAR) {
      // Ближе к одному запястью тела. Если видно оба — голос тем сильнее, чем заметнее разница.
      const margin = far === Infinity ? 1 : clamp((far - near) / ARM_MARGIN, 0, 1)
      return (dl < dr ? -1 : 1) * ARM_WEIGHT * margin
    }
    // Видно только одно запястье тела, а рука далеко от него — это другая рука (голос слабее).
    if (far === Infinity && near > ARM_FAR) return (arms.left ? 1 : -1) * ARM_WEIGHT * 0.6
    return 0
  }

  /** Голос за сторону руки: >0 — правая, <0 — левая. self — память о самой этой руке, её не считаем. */
  private vote(h: HandSeen, c: { t: number; face: FaceRef | null; aspect: number; arms: ArmRef | null }, self?: Track) {
    let v = this.armVote(h, c.arms)
    if (h.label) v += sign(h.label) * (h.score - 0.5) * 2 * (h.fist ? FIST_LABEL_WEIGHT : 1)
    const pos = c.face ? (h.x - c.face.x) / (c.face.w * POS_FACE_WIDTHS) : (h.x - c.aspect / 2) / (c.aspect / 2)
    v += clamp(pos, -1, 1) * (c.face ? POS_WEIGHT : POS_WEIGHT / 2)
    for (const side of SIDES) {
      const tr = this.tracks[side]
      if (!tr || tr === self || c.t - tr.t > MEMORY_MS || tr.frames < ESTABLISHED_FRAMES) continue
      // Чем дольше руки не было, тем дальше от ожидаемого места она может появиться.
      const radius = MEMORY_RADIUS + GATE_PER_MS * 0.3 * (c.t - tr.t)
      const d = miss(h, tr, c.t)
      if (d < radius) v += sign(side) * MEMORY_WEIGHT * (1 - d / radius)
    }
    return v
  }

  /** Узнанная рука: молодую можно поправить по голосам, старую — только если поза или метка долго и уверенно спорят. */
  private reconsider(
    side: Side,
    h: HandSeen,
    dt: number,
    c: { t: number; face: FaceRef | null; aspect: number; arms: ArmRef | null },
    out: (Side | null)[],
    i: number,
  ) {
    const tr = this.tracks[side]!
    const opp = other(side)
    const oppBusy = out.includes(opp) || (this.tracks[opp] && c.t - this.tracks[opp]!.t < KEEP_MS)
    let flip = false
    if (c.t - tr.born < YOUNG_MS) {
      tr.vote += this.vote(h, c, tr)
      flip = sign(side) * tr.vote < 0
    } else {
      const arm = this.armVote(h, c.arms)
      if (Math.abs(arm) >= ARM_SURE) {
        // Поза уверена — ей верим и для кулака.
        tr.doubt = Math.sign(arm) === sign(side) ? Math.max(0, tr.doubt - dt * 2) : tr.doubt + (dt * Math.abs(arm)) / ARM_WEIGHT
      } else if (!h.fist && h.label && h.score >= DOUBT_SCORE) {
        tr.doubt = h.label === side ? Math.max(0, tr.doubt - dt * 2) : tr.doubt + dt * (h.score - 0.5) * 2
      }
      flip = tr.doubt > FLIP_DOUBT
    }
    if (!flip || oppBusy) return
    tr.doubt = 0
    this.tracks[opp] = tr
    this.tracks[side] = null
    out[i] = opp
  }

  /** Обе руки в кадре и обе долго «не на своей стороне» (например, при появлении руки были скрещены) — меняем местами. */
  private swapIfBothWrong(out: (Side | null)[]) {
    const l = this.tracks.left
    const r = this.tracks.right
    if (!l || !r || l.doubt <= FLIP_DOUBT || r.doubt <= FLIP_DOUBT) return
    const li = out.indexOf('left')
    const ri = out.indexOf('right')
    if (li < 0 || ri < 0) return
    l.doubt = 0
    r.doubt = 0
    this.tracks = { left: r, right: l }
    out[li] = 'right'
    out[ri] = 'left'
  }
}

/** Точки позы: плечо и запястье каждой руки тела (номера — по документации MediaPipe Pose). */
const POSE_ARMS = [
  { shoulder: 11, wrist: 15 },
  { shoulder: 12, wrist: 16 },
] as const
/** Точку позы ниже этой видимости не берём (запястье за краем кадра или закрыто). */
const POSE_VISIBLE = 0.5

type PosePoint = { x: number; y: number; visibility?: number }

/**
 * Запястья рук тела по позе MediaPipe (координаты кадра без зеркала, как отдаёт модель) — в наши квадратные
 * зеркальные. Какая рука тела левая, решаем по плечам: левое плечо игрока — слева на экране, как в зеркале.
 * На метки модели не опираемся: так не важно, как она называет стороны.
 */
export function armsFromPose(lm: PosePoint[] | undefined, aspect: number): ArmRef | null {
  if (!lm || lm.length < 17) return null
  const pt = (i: number) => ({ x: (1 - lm[i].x) * aspect, y: lm[i].y, vis: lm[i].visibility ?? 1 })
  const [a, b] = POSE_ARMS.map((arm) => ({ shoulder: pt(arm.shoulder), wrist: pt(arm.wrist) }))
  // Плеч не видно — не понять, где чья рука.
  if (a.shoulder.vis < POSE_VISIBLE || b.shoulder.vis < POSE_VISIBLE) return null
  const [left, right] = a.shoulder.x < b.shoulder.x ? [a, b] : [b, a]
  const wrist = (w: { x: number; y: number; vis: number }) => (w.vis >= POSE_VISIBLE ? { x: w.x, y: w.y } : null)
  return { left: wrist(left.wrist), right: wrist(right.wrist) }
}
