import { PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, Vector3, type Group, type PerspectiveCamera as PCam } from 'three'
import { control } from '../shared/controlState'
import { runtime } from './runtime'

/**
 * Эффект «окна» (head-coupled perspective, как в демо Джонни Ли 2007).
 *
 * Экран — это окно. «Риг» — рамка окна в 3D-мире, она смотрит на героя сверху-сбоку.
 * Камера (глаз) стоит за рамкой там, где реально находится голова игрока, а перспектива
 * строится асимметрично — так, чтобы края кадра всегда проходили через края рамки.
 * Двигаешь голову влево — видишь мир чуть справа, как в настоящем окне.
 */

/** Предполагаемая ширина экрана ноутбука в метрах (14–15"). */
const PHYSICAL_SCREEN_W = 0.31
/** Ширина «окна» в единицах мира. */
const WINDOW_W = 14
/** Расстояние от окна до героя. */
const FOCUS_DISTANCE = 12
/** Наклон взгляда вниз. */
const PITCH = MathUtils.degToRad(36)
/** Усиление движения головы — чтобы эффект был заметнее. */
const HEAD_GAIN = 1.4
const NEAR = 0.3
const FAR = 400

const eye = new Vector3(0, 0, 0.6)
const focus = new Vector3()
const offset = new Vector3()
const away = new Vector3()

export function WindowCamera() {
  const rig = useRef<Group>(null)
  const cam = useRef<PCam>(null)
  const size = useThree((s) => s.size)

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    if (!rig.current || !cam.current) return

    // 1) Рамка окна следует за героем и поворачивается вместе с миром.
    focus.lerp(runtime.playerPos, 1 - Math.exp(-3 * dt))
    const yaw = -control.view.yaw
    runtime.cameraYaw = yaw
    const d = FOCUS_DISTANCE / control.view.zoom
    offset.set(Math.sin(yaw) * Math.cos(PITCH) * d, Math.sin(PITCH) * d, Math.cos(yaw) * Math.cos(PITCH) * d)
    rig.current.position.copy(focus).add(offset)
    // У группы lookAt разворачивает к цели ось +Z, а камера смотрит вдоль −Z — поэтому «смотрим» от героя.
    away.copy(rig.current.position).add(offset)
    rig.current.lookAt(away)

    // Тряска при ударе/падении.
    if (runtime.shake > 0.001) {
      rig.current.position.x += (Math.random() - 0.5) * runtime.shake * 0.6
      rig.current.position.y += (Math.random() - 0.5) * runtime.shake * 0.6
      runtime.shake *= Math.exp(-8 * dt)
    }

    // 2) Глаз — там, где голова игрока (в метрах относительно центра экрана).
    const h = control.head
    const target = h.visible ? { x: h.x * HEAD_GAIN, y: h.y * HEAD_GAIN, z: h.z } : { x: 0, y: 0, z: 0.6 }
    const k = 1 - Math.exp(-(h.visible ? 18 : 3) * dt)
    eye.x += (target.x - eye.x) * k
    eye.y += (target.y - eye.y) * k
    eye.z += (MathUtils.clamp(target.z, 0.3, 1.4) - eye.z) * k

    const aspect = size.width / size.height
    const scale = WINDOW_W / PHYSICAL_SCREEN_W // метры → единицы мира
    const halfW = WINDOW_W / 2
    const halfH = halfW / aspect
    const ex = eye.x * scale
    const ey = eye.y * scale
    const ez = eye.z * scale
    cam.current.position.set(ex, ey, ez)
    cam.current.rotation.set(0, 0, 0)

    // 3) Асимметричная перспектива через края окна.
    const n = NEAR / ez
    cam.current.projectionMatrix.makePerspective(
      (-halfW - ex) * n,
      (halfW - ex) * n,
      (halfH - ey) * n,
      (-halfH - ey) * n,
      NEAR,
      FAR,
    )
    cam.current.projectionMatrixInverse.copy(cam.current.projectionMatrix).invert()
  })

  return (
    <group ref={rig}>
      <PerspectiveCamera ref={cam} makeDefault manual near={NEAR} far={FAR} />
    </group>
  )
}
