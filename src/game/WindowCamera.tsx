import { PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, Vector3, type Group, type PerspectiveCamera as PCam } from 'three'
import { control } from '../shared/controlState'
import { runtime } from './runtime'

/**
 * Эффект «окна» (head-coupled perspective, как в демо Джонни Ли 2007) + камера, которая держит героя в центре.
 *
 * Экран — это окно, и его плоскость проходит ЧЕРЕЗ героя: поэтому герой всегда в центре кадра,
 * а движение головы поворачивает мир вокруг него — можно заглянуть за героя, под платформу, вперёд.
 *
 * Положение головы берём относительно её «обычного» места: оно медленно подстраивается под то,
 * как игрок сидит. Поэтому быстрые движения головы дают эффект, а поза игрока не сдвигает картинку.
 */

/** Предполагаемая ширина экрана ноутбука в метрах (14–15"). */
const PHYSICAL_SCREEN_W = 0.31
/** Ширина «окна» в единицах мира на уровне героя: сколько мира видно по горизонтали. */
const WINDOW_W = 12
/** Наклон взгляда вниз. */
const PITCH = MathUtils.degToRad(27)
/** Пределы наклона щипком: чтобы не уйти под землю и не смотреть строго сверху. */
const PITCH_MIN = MathUtils.degToRad(10)
const PITCH_MAX = MathUtils.degToRad(60)
/** Усиление движения головы. */
const HEAD_GAIN = 2.4
/** Максимальный сдвиг головы от обычного положения, который учитываем (м). */
const HEAD_MAX = 0.25
/** За сколько секунд «обычное» положение головы догоняет текущее. */
const NEUTRAL_ADAPT_S = 12
/** Насколько камера заглядывает вперёд по ходу движения (секунды пути). */
const LOOK_AHEAD_S = 0.45
/** Расстояние от глаза до окна, когда лица не видно (м). */
const DEFAULT_EYE_Z = 0.6
const NEAR = 0.5
const FAR = 400

const eye = new Vector3(0, 0, DEFAULT_EYE_Z)
const neutral = new Vector3(0, 0, DEFAULT_EYE_Z)
const focus = new Vector3()
const ahead = new Vector3()
const lookTarget = new Vector3()
let neutralReady = false

export function WindowCamera() {
  const rig = useRef<Group>(null)
  const cam = useRef<PCam>(null)
  const size = useThree((s) => s.size)

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    if (!rig.current || !cam.current) return

    // 1) Точка, за которой следим: герой + немного вперёд по ходу движения.
    ahead.set(runtime.playerVel.x * LOOK_AHEAD_S, 0, runtime.playerVel.z * LOOK_AHEAD_S)
    const target = lookTarget.copy(runtime.playerPos).add(ahead)
    focus.x += (target.x - focus.x) * (1 - Math.exp(-4 * dt))
    focus.z += (target.z - focus.z) * (1 - Math.exp(-4 * dt))
    // По высоте следим спокойнее, чтобы камера не прыгала вместе с героем.
    focus.y += (target.y - focus.y) * (1 - Math.exp(-2 * dt))

    // 2) Окно стоит на месте героя и смотрит на него под углом сверху; поворот мира — щипком.
    const yaw = -control.view.yaw
    runtime.cameraYaw = yaw
    rig.current.position.copy(focus)
    const pitch = MathUtils.clamp(PITCH + control.view.pitch, PITCH_MIN, PITCH_MAX)
    rig.current.rotation.set(-pitch, yaw, 0, 'YXZ')

    if (runtime.shake > 0.001) {
      rig.current.position.x += (Math.random() - 0.5) * runtime.shake * 0.6
      rig.current.position.y += (Math.random() - 0.5) * runtime.shake * 0.6
      runtime.shake *= Math.exp(-8 * dt)
    }

    // 3) Глаз — там, где голова игрока, относительно её обычного положения.
    const h = control.head
    if (h.visible) {
      if (!neutralReady) {
        neutral.set(h.x, h.y, h.z)
        neutralReady = true
      }
      neutral.lerp(h, 1 - Math.exp(-dt / NEUTRAL_ADAPT_S))
    }
    const dx = h.visible ? MathUtils.clamp(h.x - neutral.x, -HEAD_MAX, HEAD_MAX) : 0
    const dy = h.visible ? MathUtils.clamp(h.y - neutral.y, -HEAD_MAX, HEAD_MAX) : 0
    const ez = h.visible ? MathUtils.clamp(DEFAULT_EYE_Z + (h.z - neutral.z) * 0.6, 0.35, 1.0) : DEFAULT_EYE_Z
    const k = 1 - Math.exp(-(h.visible ? 22 : 3) * dt)
    eye.x += (dx * HEAD_GAIN - eye.x) * k
    eye.y += (dy * HEAD_GAIN - eye.y) * k
    eye.z += (ez - eye.z) * k

    // 4) Асимметричная перспектива: края кадра всегда проходят через края «окна».
    const windowW = WINDOW_W / control.view.zoom
    const scale = windowW / PHYSICAL_SCREEN_W // метры → единицы мира
    const halfW = windowW / 2
    const halfH = halfW / (size.width / size.height)
    const ex = eye.x * scale
    const ey = eye.y * scale
    const ezw = eye.z * scale
    cam.current.position.set(ex, ey, ezw)
    cam.current.rotation.set(0, 0, 0)

    const n = NEAR / ezw
    cam.current.projectionMatrix.makePerspective((-halfW - ex) * n, (halfW - ex) * n, (halfH - ey) * n, (-halfH - ey) * n, NEAR, FAR)
    cam.current.projectionMatrixInverse.copy(cam.current.projectionMatrix).invert()
  })

  return (
    <group ref={rig}>
      <PerspectiveCamera ref={cam} makeDefault manual near={NEAR} far={FAR} />
    </group>
  )
}
