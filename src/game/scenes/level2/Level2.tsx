import { Html, Outlines, RoundedBox } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, RigidBody, useRapier } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ExtrudeGeometry, Shape, Vector3, type Group } from 'three'
import { useGame } from '../../../shared/gameStore'
import { palette } from '../../palette'
import { Player } from '../../Player'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { toonGradient } from '../../toon'
import { Goal, Stars } from '../level1/Collectibles'
import { Platforms } from '../level1/Platforms'
import { level2, type Courtyard } from './levelData'

/**
 * Уровень 2 «Загляни». Фишка — голова: тайные звёзды спрятаны в двориках за высокими стенами.
 * С обычного ракурса внутрь не видно; подними голову (эффект окна) или наклони мир щипком —
 * как только звезду стало ВИДНО с камеры, она засчитана и прилетает к герою.
 */

const WALL_T = 0.35
const SECRET_COLOR = palette.teal
/** Сколько секунд звезду должно быть видно, чтобы она засчиталась (защита от случайного мелькания). */
const SEEN_S = 0.25
/** Дальше этого от героя звёзды не ищем — чтобы находились именно там, где игрок. */
const SEARCH_RADIUS = 14

export function Level2() {
  useEffect(() => {
    const g = useGame.getState()
    g.setStarsTotal(level2.stars.length + level2.courtyards.length)
    g.setSecretsTotal(level2.courtyards.length)
  }, [])

  return (
    <>
      <Platforms platforms={level2.platforms} />
      {level2.courtyards.map((c, i) => (
        <group key={i}>
          <CourtyardWalls c={c} />
          <SecretStar position={[c.x, c.top + 1.1, c.z]} />
        </group>
      ))}
      <Stars positions={level2.stars} />
      <GateWithFence />
      <Goal position={level2.goal} />
      <Html center position={[-2.6, 2.2, 0.6]} distanceFactor={30} zIndexRange={[10, 0]}>
        <div className="level-sign">
          <b>Загляни</b>
          <span>В двориках за стенами спрятаны тайные звёзды.</span>
          <span>Подними голову — загляни через стену. Увидел звезду — она твоя!</span>
        </div>
      </Html>
      <Player spawn={level2.spawn} killY={level2.killY} />
    </>
  )
}

/** Четыре стены вокруг дворика: снаружи внутрь не попасть — только заглянуть сверху. */
function CourtyardWalls({ c }: { c: Courtyard }) {
  const half = c.size / 2
  const walls: { pos: [number, number, number]; size: [number, number, number] }[] = [
    { pos: [0, c.height / 2, -half], size: [c.size + WALL_T, c.height, WALL_T] },
    { pos: [0, c.height / 2, half], size: [c.size + WALL_T, c.height, WALL_T] },
    { pos: [-half, c.height / 2, 0], size: [WALL_T, c.height, c.size] },
    { pos: [half, c.height / 2, 0], size: [WALL_T, c.height, c.size] },
  ]
  return (
    <RigidBody type="fixed" colliders={false} position={[c.x, c.top, c.z]}>
      {walls.map((w, i) => (
        <group key={i}>
          <CuboidCollider args={[w.size[0] / 2, w.size[1] / 2, w.size[2] / 2]} position={w.pos} />
          <RoundedBox args={w.size} radius={0.1} position={w.pos} castShadow receiveShadow>
            <meshToonMaterial color={palette.grassDark} gradientMap={toonGradient} />
            <Outlines thickness={0.035} color={palette.ink} />
          </RoundedBox>
        </group>
      ))}
    </RigidBody>
  )
}

function starGeometry() {
  const s = new Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.55 : 0.24
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 })
  g.center()
  return g
}

const camPos = new Vector3()
const toStar = new Vector3()

/** Тайная звезда: засчитывается, когда её видно с камеры (луч от камеры до звезды ничем не перекрыт). */
function SecretStar({ position }: { position: [number, number, number] }) {
  const [state, setState] = useState<'hidden' | 'flying' | 'done'>('hidden')
  const group = useRef<Group>(null)
  const seen = useRef(0)
  const star = useMemo(() => new Vector3(...position), [position])
  const geo = useMemo(starGeometry, [])
  const camera = useThree((s) => s.camera)
  const { world, rapier } = useRapier()

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const g = group.current
    if (!g || state === 'done') return

    if (state === 'hidden') {
      g.rotation.y = clock.elapsedTime * 2
      g.position.y = Math.sin(clock.elapsedTime * 2.5) * 0.12
      if (useGame.getState().phase !== 'playing' || runtime.playerPos.distanceTo(star) > SEARCH_RADIUS) {
        seen.current = 0
        return
      }
      camera.getWorldPosition(camPos)
      toStar.copy(star).sub(camPos)
      const dist = toStar.length()
      toStar.divideScalar(dist)
      const ray = new rapier.Ray(camPos, toStar)
      const hit = world.castRay(ray, dist - 0.45, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, runtime.playerBody ?? undefined)
      seen.current = hit ? Math.max(0, seen.current - dt * 2) : seen.current + dt
      if (seen.current > SEEN_S) {
        setState('flying')
        const s = useGame.getState()
        s.findSecret()
        s.collectStar()
        burst(star, SECRET_COLOR, 24, 5)
        sfx.star()
      }
      return
    }

    // Нашёл — звезда летит к герою.
    const target = runtime.playerPos.clone().add(new Vector3(0, 1.2, 0)).sub(star)
    g.position.lerp(target, 1 - Math.exp(-6 * dt))
    g.rotation.y += dt * 12
    if (g.position.distanceTo(target) < 0.3) {
      burst(runtime.playerPos.clone().setY(runtime.playerPos.y + 1), SECRET_COLOR, 12, 3)
      setState('done')
    }
  })

  if (state === 'done') return null
  return (
    <group position={position}>
      <group ref={group}>
        <mesh geometry={geo}>
          <meshToonMaterial color={SECRET_COLOR} emissive={SECRET_COLOR} emissiveIntensity={1.1} gradientMap={toonGradient} />
          <Outlines thickness={0.03} color={palette.ink} />
        </mesh>
      </group>
    </group>
  )
}

/** Ворота перед финишем + забор вдоль края острова: открываются, когда найдены все тайные звёзды. */
function GateWithFence() {
  const found = useGame((s) => s.secretsFound)
  const total = useGame((s) => s.secretsTotal)
  const open = total > 0 && found >= total
  const { x, z, top, width } = level2.gate
  const H = 2.8
  const fence = [
    { z0: -19.5, z1: z - width / 2 },
    { z0: z + width / 2, z1: -10.5 },
  ]

  useEffect(() => {
    if (!open) return
    burst(new Vector3(x, top + 1.5, z), palette.star, 40, 6)
    sfx.finish()
  }, [open, x, top, z])

  return (
    <RigidBody type="fixed" colliders={false} position={[x, top, 0]}>
      {fence.map((f, i) => {
        const len = f.z1 - f.z0
        const cz = (f.z0 + f.z1) / 2
        return (
          <group key={i}>
            <CuboidCollider args={[WALL_T / 2, H / 2, len / 2]} position={[0, H / 2, cz]} />
            <RoundedBox args={[WALL_T, H, len]} radius={0.1} position={[0, H / 2, cz]} castShadow>
              <meshToonMaterial color={palette.stone} gradientMap={toonGradient} />
              <Outlines thickness={0.035} color={palette.ink} />
            </RoundedBox>
          </group>
        )
      })}
      {!open && (
        <group>
          <CuboidCollider args={[WALL_T / 2, H / 2, width / 2]} position={[0, H / 2, z]} />
          <RoundedBox args={[WALL_T * 1.4, H, width]} radius={0.1} position={[0, H / 2, z]} castShadow>
            <meshToonMaterial color={SECRET_COLOR} emissive={SECRET_COLOR} emissiveIntensity={0.3} gradientMap={toonGradient} />
            <Outlines thickness={0.035} color={palette.ink} />
          </RoundedBox>
          <Html center position={[0.6, H + 0.6, z]} distanceFactor={30} zIndexRange={[10, 0]}>
            <div className="level-sign level-sign--small">
              Ворота откроются: тайные звёзды {found}/{total}
            </div>
          </Html>
        </group>
      )}
    </RigidBody>
  )
}
