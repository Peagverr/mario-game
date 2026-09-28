import { Outlines } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier'
import { useRef } from 'react'
import { MathUtils, Vector3, type Group } from 'three'
import { control } from '../shared/controlState'
import { useGame } from '../shared/gameStore'
import { palette } from './palette'
import { burst, runtime } from './runtime'
import { sfx } from './sfx'
import { toonGradient } from './toon'

const RADIUS = 0.35
const HALF_HEIGHT = 0.35
const SPEED = 5.2
const JUMP_VELOCITY = 9.2
/** Прыжок засчитывается, если жест был чуть раньше приземления… */
const JUMP_BUFFER_S = 0.25
/** …или чуть позже схода с края («время койота»). */
const COYOTE_S = 0.14

const toFeet = HALF_HEIGHT + RADIUS
const tmp = new Vector3()

type Props = { spawn: [number, number, number]; killY: number }

export function Player({ spawn, killY }: Props) {
  const body = useRef<RapierRigidBody>(null)
  const visual = useRef<Group>(null)
  const { world, rapier } = useRapier()

  const st = useRef({
    lastJumpSeq: control.jumpSeq,
    jumpBufferedUntil: 0,
    lastGroundedAt: 0,
    grounded: false,
    wasGrounded: true,
    checkpoint: new Vector3(...spawn),
    squash: 0,
    facing: 0,
    minVy: 0,
    t: 0,
  })

  useFrame((_, dtRaw) => {
    const b = body.current
    if (!b) return
    const dt = Math.min(dtRaw, 0.05)
    const s = st.current
    s.t += dt
    const phase = useGame.getState().phase
    const canMove = phase === 'playing' || phase === 'tutorial'

    const pos = b.translation()
    const vel = b.linvel()

    // — Земля под ногами: луч вниз —
    const ray = new rapier.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 })
    const hit = world.castRay(ray, toFeet + 0.12, true, undefined, undefined, undefined, b)
    s.grounded = !!hit && vel.y < 2.5
    let carry: Vector3 | undefined
    if (hit && s.grounded) {
      s.lastGroundedAt = s.t
      const cp = runtime.checkpoints.get(hit.collider.handle)
      if (cp) s.checkpoint.copy(cp)
      carry = runtime.movers.get(hit.collider.handle)
    }

    // Приземление: сжатие, пыль, звук.
    if (s.grounded && !s.wasGrounded) {
      if (s.minVy < -5) {
        s.squash = Math.min(1, -s.minVy / 14)
        burst(tmp.set(pos.x, pos.y - toFeet + 0.1, pos.z), palette.heroCream, 8, 2.5)
        sfx.land()
      }
      s.minVy = 0
    }
    if (!s.grounded) s.minVy = Math.min(s.minVy, vel.y)
    s.wasGrounded = s.grounded

    // — Ходьба относительно камеры: «вправо» на экране = вправо для героя —
    const yaw = runtime.cameraYaw
    const mx = canMove ? control.move.x : 0
    const my = canMove ? control.move.y : 0
    const dirX = mx * Math.cos(yaw) - my * Math.sin(yaw)
    const dirZ = -mx * Math.sin(yaw) - my * Math.cos(yaw)
    const accel = s.grounded ? 14 : 6
    const k = 1 - Math.exp(-accel * dt)
    let vx = vel.x + (dirX * SPEED + (carry?.x ?? 0) - vel.x) * k
    let vz = vel.z + (dirZ * SPEED + (carry?.z ?? 0) - vel.z) * k
    let vy = vel.y

    // — Прыжок —
    if (control.jumpSeq !== s.lastJumpSeq) {
      s.lastJumpSeq = control.jumpSeq
      if (canMove) s.jumpBufferedUntil = s.t + JUMP_BUFFER_S
    }
    if (s.jumpBufferedUntil > s.t && s.t - s.lastGroundedAt < COYOTE_S) {
      vy = JUMP_VELOCITY
      s.jumpBufferedUntil = 0
      s.lastGroundedAt = -1
      s.squash = -0.6
      sfx.jump()
    }
    if (!canMove && phase !== 'paused') {
      vx *= 0.8
      vz *= 0.8
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true)

    // — Падение в пропасть —
    if (pos.y < killY) {
      b.setTranslation({ x: s.checkpoint.x, y: s.checkpoint.y, z: s.checkpoint.z }, true)
      b.setLinvel({ x: 0, y: 0, z: 0 }, true)
      runtime.shake = 0.8
      sfx.fall()
      if (phase === 'playing') useGame.getState().addFall()
    }

    runtime.playerPos.set(pos.x, pos.y, pos.z)
    runtime.playerVel.set(vx, vy, vz)

    // — Внешний вид: поворот к направлению движения, сжатие/растяжение, «дыхание» —
    const v = visual.current
    if (v) {
      const speed = Math.hypot(vx - (carry?.x ?? 0), vz - (carry?.z ?? 0))
      if (speed > 0.5) s.facing = Math.atan2(vx, vz)
      v.rotation.y = MathUtils.lerp(v.rotation.y, s.facing + angleWrap(v.rotation.y, s.facing), 1 - Math.exp(-12 * dt))
      s.squash = MathUtils.lerp(s.squash, 0, 1 - Math.exp(-10 * dt))
      const breathe = s.grounded && speed < 0.5 ? Math.sin(s.t * 3) * 0.03 : 0
      const sy = 1 - s.squash * 0.35 + breathe
      const sxz = 1 + s.squash * 0.25 - breathe * 0.5
      v.scale.set(sxz, sy, sxz)
      const bob = s.grounded && speed > 0.5 ? Math.abs(Math.sin(s.t * 14)) * 0.08 : 0
      v.position.y = -toFeet * (1 - sy) + bob
    }
  })

  return (
    <RigidBody
      ref={body}
      name="player"
      colliders={false}
      position={spawn}
      enabledRotations={[false, false, false]}
      ccd
      canSleep={false}
      friction={0}
    >
      <CapsuleCollider args={[HALF_HEIGHT, RADIUS]} friction={0} />
      <group ref={visual}>
        <Hero />
      </group>
    </RigidBody>
  )
}

/** Поправка, чтобы поворот шёл коротким путём (через ±π). */
function angleWrap(from: number, to: number) {
  const d = to - from
  return d > Math.PI ? -Math.PI * 2 : d < -Math.PI ? Math.PI * 2 : 0
}

/** Герой из простых фигур. Потом заменится на 3D-модель — снаружи ничего менять не придётся. */
function Hero() {
  const o = { thickness: 0.04, color: palette.ink }
  return (
    <group>
      <mesh castShadow>
        <capsuleGeometry args={[RADIUS, HALF_HEIGHT * 2, 6, 16]} />
        <meshToonMaterial color={palette.hero} gradientMap={toonGradient} />
        <Outlines {...o} />
      </mesh>
      <mesh position={[0, -0.05, 0.12]} castShadow>
        <sphereGeometry args={[0.27, 16, 16]} />
        <meshToonMaterial color={palette.heroCream} gradientMap={toonGradient} />
      </mesh>
      {[-0.12, 0.12].map((x) => (
        <group key={x} position={[x, 0.28, 0.3]}>
          <mesh>
            <sphereGeometry args={[0.085, 12, 12]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0, 0.055]}>
            <sphereGeometry args={[0.045, 10, 10]} />
            <meshBasicMaterial color={palette.ink} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.45, 0]} castShadow>
        <sphereGeometry args={[0.37, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshToonMaterial color={palette.teal} gradientMap={toonGradient} />
        <Outlines {...o} />
      </mesh>
      <mesh position={[0, 0.47, 0.32]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.5, 0.05, 0.3]} />
        <meshToonMaterial color={palette.teal} gradientMap={toonGradient} />
      </mesh>
    </group>
  )
}
