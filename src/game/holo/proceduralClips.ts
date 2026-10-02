import { FRAME_LEN, makeClip, type HandClip, type HandSide } from './clip'
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuint, lerp, span } from './ease'
import { OPEN_POSE, poseHand, type HandPose } from './handPose'

/**
 * Процедурные клипы — пока нет записей живой руки. Каждый клип — функция времени → поза и сдвиг ладони;
 * считаем её с частотой FPS и упаковываем в обычный клип (тот же формат, что и запись).
 * Движение поставлено «как у живого»: запястье ведёт, пальцы догоняют, пальцы закрываются волной,
 * перед кулаком — замах (пальцы чуть раскрываются), в покое — едва заметное покачивание.
 */

const FPS = 30
const SWAY_S = 2.4

type Frame = { pose: HandPose; move: [number, number, number] }
type ClipFn = (t: number) => Frame

const pose = (p: Partial<HandPose> & { curl?: HandPose['curl'] } = {}): HandPose => ({
  ...OPEN_POSE,
  ...p,
  curl: p.curl ?? ([...OPEN_POSE.curl] as HandPose['curl']),
})

/** Живое покачивание открытой ладони: медленное, разные частоты — не «маятник». */
function sway(t: number, amount = 1) {
  const w = (2 * Math.PI) / SWAY_S
  return {
    roll: 0.045 * amount * Math.sin(w * t),
    pitch: 0.03 * amount * Math.sin(w * 0.63 * t + 1.1),
    bob: 0.0025 * amount * Math.sin(w * 1.3 * t + 0.4),
  }
}

function bake(name: string, hand: HandSide, duration: number, fn: ClipFn, ring = 0): HandClip {
  const count = Math.round(duration * FPS)
  const frames: Float32Array[] = []
  const move: number[][] = []
  for (let i = 0; i < count; i++) {
    const f = fn(i / FPS)
    frames.push(poseHand(f.pose, hand, new Float32Array(FRAME_LEN)))
    move.push(f.move)
  }
  return makeClip(name, hand, FPS, frames, move, ring)
}

/** Правая ладонь поднимается снизу (пальцы раскрываются волной от указательного), держится, опускается. */
const LOW = -0.11
const RELAX = 0.32
const palmRaise: ClipFn = (t) => {
  const up = span(t, 0.2, 1.05, (x) => easeOutBack(x, 1.1)) - span(t, 2.85, 3.45, easeInCubic)
  // Кисть «доворачивается» к камере чуть позже подъёма — запястье ведёт, пальцы догоняют.
  const face = span(t, 0.35, 1.2, easeOutCubic) - span(t, 2.75, 3.3, easeInOutCubic)
  const s = sway(t, span(t, 0.9, 1.6))
  const open = (lag: number) => span(t, 0.45 + lag, 1.05 + lag, easeOutCubic) - span(t, 2.9 + lag * 0.5, 3.4, easeInOutCubic)
  const curl = [0, 0.02, 0.05, 0.09, 0.13].map((lag, i) => lerp(RELAX, OPEN_POSE.curl[i], open(lag))) as HandPose['curl']
  return {
    pose: pose({ curl, spread: lerp(0.25, 1, open(0.05)), roll: s.roll + (1 - face) * 0.12, pitch: lerp(0.62, 0, face) + s.pitch }),
    move: [0, lerp(LOW, 0, up) + s.bob, 0],
  }
}

/** Открытая ладонь в круге → вверх из круга (герой идёт вперёд) → обратно в центр. */
const STEP = 0.09
const palmMove: ClipFn = (t) => {
  const out = span(t, 0.7, 1.25, easeInOutCubic) - span(t, 2.15, 2.7, easeInOutCubic)
  // Пальцы чуть отстают от движения ладони: при разгоне вверх кончики «отклоняются» назад.
  const lagUp = Math.sin(Math.PI * span(t, 0.7, 1.35, (x) => x)) - Math.sin(Math.PI * span(t, 2.15, 2.8, (x) => x))
  const s = sway(t, 0.6)
  return {
    pose: pose({ roll: s.roll, pitch: s.pitch - 0.09 * lagUp }),
    move: [0, STEP * out + s.bob, 0],
  }
}

/**
 * Открытая ладонь → замах → кулак (прыжок) → держит → раскрывается.
 * Кулак строго анфас — это кучка укороченных костей; поэтому, сжимаясь, кисть поворачивается на три четверти
 * (мизинцем к зрителю) — видно, как пальцы сворачиваются дугой. Раскрылась — снова анфас.
 */
const FIST_TURN = -0.9
const fist: ClipFn = (t) => {
  // Замах: пальцы на миг раскрываются шире и кисть приседает.
  const wind = span(t, 0.5, 0.68, easeOutCubic) * (1 - span(t, 0.68, 0.8, easeInCubic))
  const closeAt = (lag: number) => span(t, 0.7 + lag, 0.9 + lag, easeOutQuint) * (1 - span(t, 1.55 + lag * 0.5, 1.95 + lag, easeOutCubic))
  const curl = [0.06, 0, 0.025, 0.05, 0.075].map((lag, i) => {
    const c = closeAt(lag)
    return lerp(OPEN_POSE.curl[i] - 0.09 * wind, 1, c)
  }) as HandPose['curl']
  const closed = closeAt(0.03)
  // Сжатие — кисть подпрыгивает (это и есть прыжок) и чуть наклоняется вперёд.
  const pop = span(t, 0.72, 0.95, easeOutBack) * (1 - span(t, 1.15, 1.6, easeInOutCubic))
  const s = sway(t, 0.5)
  return {
    pose: pose({ curl, spread: lerp(1 + 0.18 * wind, 0, closed), roll: s.roll, pitch: s.pitch + 0.28 * closed, yaw: FIST_TURN * span(t, 0.62, 1.0, easeInOutCubic) * (1 - span(t, 1.6, 2.15, easeInOutCubic)) }),
    move: [0, -0.006 * wind + 0.016 * pop + s.bob, 0],
  }
}

/** Левая раскрытая ладонь: показалась → ведёт мир в сторону → обратно. */
const SWEEP = 0.11
const leftSweep: ClipFn = (t) => {
  const out = span(t, 0.65, 1.4, easeInOutCubic) - span(t, 1.85, 2.6, easeInOutCubic)
  // Ладонь чуть «наклоняется» по ходу движения, как рука, которая тянет.
  const lean = Math.sin(Math.PI * span(t, 0.65, 1.4, (x) => x)) - Math.sin(Math.PI * span(t, 1.85, 2.6, (x) => x))
  const s = sway(t, 0.6)
  return {
    pose: pose({ roll: s.roll + 0.1 * lean, yaw: -0.1 * lean, pitch: s.pitch }),
    move: [-SWEEP * out, s.bob, 0],
  }
}

/** Радиус круга-джойстика за ладонью (м) — ладонь выходит из него вверх. */
const RING = 0.052

export function proceduralClips(): HandClip[] {
  return [
    bake('palm-raise', 'right', 3.6, palmRaise),
    bake('palm-move', 'right', 3.4, palmMove, RING),
    bake('fist', 'right', 2.6, fist),
    bake('left-palm-sweep', 'left', 3.2, leftSweep),
  ]
}
