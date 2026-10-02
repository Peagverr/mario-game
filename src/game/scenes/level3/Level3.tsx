import { Html, Outlines } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierCollider } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { MathUtils, Vector3, type Mesh, type MeshToonMaterial } from 'three'
import { useGame } from '../../../shared/gameStore'
import { palette } from '../../palette'
import { Player } from '../../Player'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { PRIORITY, say } from '../../voice'
import { toonGradient } from '../../toon'
import { Goal, Stars } from '../level1/Collectibles'
import { Platforms } from '../level1/Platforms'
import type { Platform } from '../level1/levelData'

/**
 * Уровень 3 «Поверни мир». Фишка — щипок левой рукой: мосты-«призраки» собраны из досок, рассыпанных в воздухе.
 * Поворачиваешь мир — доски съезжаются; под нужным углом мост собирается и становится твёрдым (как в Fez и Captain Toad).
 * Мягкие края не дают шагнуть на несобранный мост — герой подождёт на краю.
 */

type Bridge = {
  /** Начало и конец моста (центр верхней поверхности), высота — top. */
  from: [number, number]
  to: [number, number]
  top: number
  width: number
  /** Под каким поворотом камеры мост собирается (радианы). */
  targetYaw: number
}

const PLATFORMS: Platform[] = [
  { x: 0, z: 0, top: 0, w: 8, d: 8, h: 2.4, kind: 'island', checkpoint: true, trees: [[-2.8, 2.8]] },
  { x: 13, z: 0, top: 0, w: 8, d: 8, h: 2.4, kind: 'island', checkpoint: true, trees: [[2.8, 2.8]] },
  { x: 13, z: -12.5, top: 0, w: 8, d: 8, h: 2.4, kind: 'island', checkpoint: true, trees: [[2.8, -2.8]] },
  { x: 0, z: -12.5, top: 0, w: 8, d: 8, h: 2.4, kind: 'island', checkpoint: true },
]
const BRIDGES: Bridge[] = [
  { from: [4, 0], to: [9, 0], top: 0, width: 2.4, targetYaw: 0.8 },
  { from: [13, -4], to: [13, -8.5], top: 0, width: 2.4, targetYaw: -0.8 },
  { from: [9, -12.5], to: [4, -12.5], top: 0, width: 2.4, targetYaw: 1.5 },
]
const STARS: [number, number, number][] = [
  [-2, 1, -2],
  [2, 1, 2],
  [6.5, 1.2, 0],
  [15, 1, 2],
  [13, 1.2, -6.2],
  [11, 1, -14.5],
  [15.5, 1, -10.5],
  [6.5, 1.2, -12.5],
  [-2.5, 1, -10.5],
]
/** Мост твёрдый, если поворот камеры отличается от нужного меньше чем на столько. */
const SNAP = MathUtils.degToRad(12)
/** Дальше этого угла доски разлетаются по максимуму. */
const SPREAD_ANGLE = 0.7

/** Разница углов в пределах −π..π. */
function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

export function Level3() {
  useEffect(() => useGame.getState().setStarsTotal(STARS.length), [])
  return (
    <>
      <Platforms platforms={PLATFORMS} />
      {BRIDGES.map((b, i) => (
        <GhostBridge key={i} b={b} />
      ))}
      <Stars positions={STARS} />
      <Goal position={[-1.2, 0, -14]} />
      <Html center position={[-2.2, 2.4, 1.2]} distanceFactor={30} zIndexRange={[10, 0]}>
        <div className="level-sign">
          <b>Поверни мир</b>
          <span>Мосты собираются только под нужным углом.</span>
          <span>Сделай щипок левой рукой и веди в сторону — доски съедутся в мост.</span>
        </div>
      </Html>
      <Player spawn={[0, 1.2, 0]} killY={-10} />
    </>
  )
}

function GhostBridge({ b }: { b: Bridge }) {
  const collider = useRef<RapierCollider>(null)
  const planks = useRef<(Mesh | null)[]>([])
  const sign = useRef<HTMLDivElement>(null)
  // true, чтобы в первом кадре коллайдер выключился (мост стартует рассыпанным).
  const wasSolid = useRef(true)
  const firstFrame = useRef(true)

  const geo = useMemo(() => {
    const dx = b.to[0] - b.from[0]
    const dz = b.to[1] - b.from[1]
    const len = Math.hypot(dx, dz)
    const count = Math.max(3, Math.round(len / 0.62))
    const angle = Math.atan2(dx, dz)
    const center = new Vector3((b.from[0] + b.to[0]) / 2, b.top, (b.from[1] + b.to[1]) / 2)
    // Для каждой доски — своё «случайное» направление разлёта (одинаковое при каждом запуске).
    const scatter = Array.from({ length: count }, (_, i) => ({
      y: (((i * 37) % 7) - 3) / 3,
      side: (((i * 53) % 5) - 2) / 2,
      spin: (((i * 29) % 9) - 4) / 4,
    }))
    return { len, count, angle, center, scatter }
  }, [b])

  useFrame((_, dt) => {
    const diff = angleDiff(runtime.cameraYaw, b.targetYaw)
    const m = MathUtils.clamp((Math.abs(diff) - SNAP) / (SPREAD_ANGLE - SNAP), 0, 1)

    // Пока герой стоит на мосту, мост не рассыпается — иначе поворот мира сбрасывал бы его в пропасть.
    const local = runtime.playerPos.clone().sub(geo.center).applyAxisAngle(new Vector3(0, 1, 0), -geo.angle)
    const onBridge = Math.abs(local.x) < b.width / 2 + 0.4 && Math.abs(local.z) < geo.len / 2 + 0.3 && Math.abs(local.y - 0.7) < 1
    const solid = Math.abs(diff) < SNAP || (wasSolid.current && onBridge)

    if (solid !== wasSolid.current) {
      collider.current?.setEnabled(solid)
      if (solid && !firstFrame.current) {
        burst(geo.center.clone().setY(b.top + 0.5), palette.star, 26, 5)
        sfx.confirm()
        // «Мост собран. Нужен был другой угол» — за забег один раз, на первом собранном мосту.
        say('rotate.done', { priority: PRIORITY.story, waitMs: 2500, once: `bridge-${useGame.getState().runId}` })
      }
      wasSolid.current = solid
    }

    firstFrame.current = false
    const spread = solid ? 0 : m
    planks.current.forEach((p, i) => {
      if (!p) return
      const s = geo.scatter[i]
      const z = -geo.len / 2 + (i + 0.5) * (geo.len / geo.count)
      p.position.set(s.side * 1.4 * spread, -0.1 + s.y * 1.8 * spread, z)
      p.rotation.set(s.spin * 0.8 * spread, s.spin * 1.2 * spread, 0)
      const mat = p.material as MeshToonMaterial
      mat.opacity = MathUtils.lerp(mat.opacity, solid ? 1 : 0.35 + 0.35 * (1 - m), 1 - Math.exp(-10 * dt))
    })

    // Подсказка у начала моста: в какую сторону вести щипок.
    const el = sign.current
    if (el) {
      const text = solid
        ? 'Мост собран — вперёд!'
        : diff > 0
          ? 'Поверни мир: щипок левой → веди вправо'
          : 'Поверни мир: щипок левой → веди влево'
      if (el.textContent !== text) el.textContent = text
      el.classList.toggle('is-ok', solid)
    }
  })

  const start = new Vector3(b.from[0], b.top, b.from[1])
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={geo.center} rotation={[0, geo.angle, 0]}>
        <CuboidCollider ref={collider} args={[b.width / 2, 0.15, geo.len / 2]} position={[0, -0.15, 0]} friction={0} />
        {geo.scatter.map((_, i) => (
          <mesh key={i} ref={(m) => void (planks.current[i] = m)} castShadow>
            <boxGeometry args={[b.width, 0.2, (geo.len / geo.count) * 0.9]} />
            <meshToonMaterial color={palette.wood} gradientMap={toonGradient} transparent opacity={0.5} />
            <Outlines thickness={0.03} color={palette.ink} />
          </mesh>
        ))}
      </RigidBody>
      <Html center position={[start.x, b.top + 1.9, start.z]} distanceFactor={26} zIndexRange={[10, 0]}>
        <div ref={sign} className="level-sign level-sign--small bridge-sign" />
      </Html>
    </>
  )
}
