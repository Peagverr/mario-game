import { Quaternion, Vector3 } from 'three'
import type { HandSide } from './clip'
import { FRAME_LEN } from './clip'

/**
 * Процедурная рука: поза из нескольких параметров → 21 точка MediaPipe (метры, оси клипа — см. clip.ts).
 *
 * Скелет — пропорции взрослой руки (~18 см от запястья до кончика среднего): костяшки лежат дугой,
 * пальцы в покое чуть разведены веером, большой палец отведён и смотрит немного к зрителю.
 * Сгиб пальца: суставы сгибаются в плоскости пальца к ладони; средний и дальний сустав начинают раньше
 * основного — пальцы «сворачиваются» с кончиков, как у живой руки. Кости не растягиваются: точки ставятся
 * от сустава к суставу по направлению × длина.
 * Канон — правая рука ладонью к зрителю (как в зеркале: большой палец слева); левая — отражение по x.
 */

export type HandPose = {
  /** Сгиб 0 — выпрямлен, 1 — в кулаке: [большой, указательный, средний, безымянный, мизинец]. Чуть меньше 0 — перерастяжение. */
  curl: [number, number, number, number, number]
  /** Разведение пальцев: 0 — сомкнуты, 1 — естественный веер. */
  spread: number
  /** Поворот кисти, рад: roll — вокруг оси экрана, pitch — пальцы к зрителю (+) или от него, yaw — ладонь вбок. */
  roll: number
  pitch: number
  yaw: number
}

export const OPEN_POSE: HandPose = { curl: [0.04, 0.03, 0.03, 0.04, 0.05], spread: 1, roll: 0, pitch: 0, yaw: 0 }

const DEG = Math.PI / 180

const WRIST = new Vector3(0, 0, 0)
/** Основание большого (точка 1, запястно-пястный сустав) и костяшки четырёх пальцев: дуга, средний выше всех. */
const THUMB_CMC = new Vector3(-0.02, 0.024, 0.01)
const MCP = [
  new Vector3(-0.027, 0.084, -0.004),
  new Vector3(-0.007, 0.089, -0.006),
  new Vector3(0.012, 0.083, -0.004),
  new Vector3(0.029, 0.071, 0),
]
/** Фаланги [основная, средняя, ногтевая], м. */
const PHALANX = [
  [0.04, 0.024, 0.021],
  [0.045, 0.028, 0.022],
  [0.042, 0.027, 0.022],
  [0.033, 0.019, 0.019],
]
/** Веер пальцев (отклонение от вертикали к большому пальцу, градусы): разведены / сомкнуты в кулаке. */
const FAN_OPEN = [10, 1, -8, -19]
const FAN_CLOSED = [3, 0, -3, -7]
/** Ладонь в кулаке «складывается»: пястные кости безымянного и мизинца поворачиваются к зрителю (градусы). */
const CUP = [0, 0, 3, 7]

/** Большой палец: пястная кость и две фаланги — длины и направления открыто / в кулаке (обхватывает средние фаланги). */
const THUMB_LEN = [0.04, 0.031, 0.026]
const THUMB_OPEN = [new Vector3(-0.62, 0.72, 0.3), new Vector3(-0.5, 0.83, 0.24), new Vector3(-0.38, 0.91, 0.17)].map((v) => v.normalize())
const THUMB_FIST = [new Vector3(-0.45, 0.65, 0.62), new Vector3(0.37, 0.74, 0.56), new Vector3(0.98, -0.08, -0.16)].map((v) => v.normalize())

/** Центр ладони в каноне — вокруг него вращаем, он же начало координат клипа. */
export const PALM_CENTER = new Vector3(0, 0.062, 0)

const NORMAL = new Vector3(0, 0, 1)
const UP = new Vector3(0, 1, 0)

// Рабочие объекты — поза считается без выделения памяти.
const pts = Array.from({ length: 21 }, () => new Vector3())
const dir = new Vector3()
const axis = new Vector3()
const q = new Quaternion()
const qa = new Quaternion()
const qb = new Quaternion()
const rot = new Quaternion()
const qx = new Quaternion()
const qy = new Quaternion()
const qz = new Quaternion()
const AX = new Vector3(1, 0, 0)
const AY = new Vector3(0, 1, 0)
const AZ = new Vector3(0, 0, 1)

const ease = (t: number, p: number) => Math.sign(t) * Math.abs(t) ** p

/** Поза → 63 числа (x,y,z × 21) в осях клипа. */
export function poseHand(pose: HandPose, hand: HandSide, out: Float32Array = new Float32Array(FRAME_LEN)) {
  pts[0].copy(WRIST)

  // Большой палец: каждую кость поворачиваем от открытого направления к «кулачному».
  pts[1].copy(THUMB_CMC)
  const tc = pose.curl[0]
  for (let k = 0; k < 3; k++) {
    // Дальние фаланги догоняют позже — палец обхватывает, а не складывается целиком.
    const tk = Math.min(1, Math.max(0, (tc - k * 0.08) / (1 - k * 0.08)))
    qa.setFromUnitVectors(UP, THUMB_OPEN[k])
    qb.setFromUnitVectors(UP, THUMB_FIST[k])
    q.slerpQuaternions(qa, qb, tk)
    dir.copy(UP).applyQuaternion(q)
    pts[2 + k].copy(pts[1 + k]).addScaledVector(dir, THUMB_LEN[k])
  }

  // Четыре пальца: веер вокруг нормали ладони, сгиб — в плоскости пальца к ладони.
  for (let f = 0; f < 4; f++) {
    const c = pose.curl[f + 1]
    const base = 5 + f * 4
    // Поворот пястной кости вокруг запястья — длина «запястье → костяшка» не меняется.
    axis.crossVectors(MCP[f], NORMAL).normalize()
    q.setFromAxisAngle(axis, CUP[f] * DEG * Math.max(0, c))
    pts[base].copy(MCP[f]).applyQuaternion(q)
    const fan = (FAN_CLOSED[f] + (FAN_OPEN[f] - FAN_CLOSED[f]) * pose.spread * (1 - 0.7 * Math.max(0, c))) * DEG
    dir.set(-Math.sin(fan), Math.cos(fan), 0)
    axis.crossVectors(dir, NORMAL).normalize()
    // Основной сустав сгибается позже, средний и дальний — раньше («сворачивание с кончиков»).
    const flex = [(4 + 86 * ease(c, 1.25)) * DEG, (6 + 98 * ease(c, 0.8)) * DEG, (4 + 66 * ease(c, 0.9)) * DEG]
    let angle = 0
    for (let k = 0; k < 3; k++) {
      angle += flex[k]
      q.setFromAxisAngle(axis, angle)
      const seg = pts[base + 1 + k]
      seg.copy(dir).applyQuaternion(q).multiplyScalar(PHALANX[f][k]).add(pts[base + k])
    }
  }

  // Поворот всей кисти вокруг центра ладони: сначала вбок, потом к зрителю, потом вокруг оси экрана.
  qx.setFromAxisAngle(AX, pose.pitch)
  qy.setFromAxisAngle(AY, pose.yaw)
  qz.setFromAxisAngle(AZ, pose.roll)
  rot.copy(qz).multiply(qx).multiply(qy)

  // Левая — зеркало правой (вместе с поворотами: roll «наружу» у обеих рук один и тот же).
  const mirror = hand === 'left' ? -1 : 1
  for (let i = 0; i < 21; i++) {
    const p = pts[i].sub(PALM_CENTER).applyQuaternion(rot)
    out[i * 3] = p.x * mirror
    out[i * 3 + 1] = p.y
    out[i * 3 + 2] = p.z
  }
  return out
}
