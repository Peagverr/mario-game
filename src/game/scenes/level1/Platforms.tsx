import { Outlines, RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierCollider, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { palette } from '../../palette'
import { runtime } from '../../runtime'
import { toonGradient } from '../../toon'
import type { Platform } from './levelData'

const OUTLINE = { thickness: 0.035, color: palette.ink }

function Toon({ color }: { color: string }) {
  return <meshToonMaterial color={color} gradientMap={toonGradient} />
}

/** Остров: трава сверху, земля по бокам, каменный «корень» снизу — как парящий остров. */
function IslandMesh({ p }: { p: Platform }) {
  const grassH = 0.35
  return (
    <group>
      <RoundedBox args={[p.w, grassH, p.d]} radius={0.15} smoothness={3} position={[0, -grassH / 2, 0]} castShadow receiveShadow>
        <Toon color={palette.grass} />
        <Outlines {...OUTLINE} />
      </RoundedBox>
      <RoundedBox args={[p.w * 0.96, p.h - grassH, p.d * 0.96]} radius={0.2} smoothness={3} position={[0, -grassH - (p.h - grassH) / 2, 0]} castShadow receiveShadow>
        <Toon color={palette.dirt} />
        <Outlines {...OUTLINE} />
      </RoundedBox>
      <mesh position={[0, -p.h - Math.min(p.w, p.d) * 0.35, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[Math.min(p.w, p.d) * 0.45, Math.min(p.w, p.d) * 0.7, 7]} />
        <Toon color={palette.rock} />
        <Outlines {...OUTLINE} />
      </mesh>
      {p.trees?.map(([tx, tz], i) => <Tree key={i} x={tx} z={tz} />)}
    </group>
  )
}

function Tree({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 1, 6]} />
        <Toon color={palette.trunk} />
        <Outlines {...OUTLINE} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <coneGeometry args={[0.8, 1.5, 7]} />
        <Toon color={palette.leaf} />
        <Outlines {...OUTLINE} />
      </mesh>
      <mesh position={[0, 2.2, 0]} castShadow>
        <coneGeometry args={[0.55, 1.1, 7]} />
        <Toon color={palette.leaf} />
        <Outlines {...OUTLINE} />
      </mesh>
    </group>
  )
}

function SlabMesh({ p }: { p: Platform }) {
  return (
    <RoundedBox args={[p.w, p.h, p.d]} radius={0.12} smoothness={3} position={[0, -p.h / 2, 0]} castShadow receiveShadow>
      <Toon color={p.kind === 'wood' ? palette.wood : palette.stone} />
      <Outlines {...OUTLINE} />
    </RoundedBox>
  )
}

/** Коллайдер под платформой + регистрация чекпоинта. Деревья — тоже препятствия. */
function PlatformColliders({ p }: { p: Platform }) {
  const col = useRef<RapierCollider>(null)
  useEffect(() => {
    const c = col.current
    if (!c || !p.checkpoint) return
    runtime.checkpoints.set(c.handle, new Vector3(p.x, p.top + 1.2, p.z))
    return () => void runtime.checkpoints.delete(c.handle)
  }, [p])
  return (
    <>
      <CuboidCollider ref={col} args={[p.w / 2, p.h / 2, p.d / 2]} position={[0, -p.h / 2, 0]} friction={0} />
      {p.trees?.map(([tx, tz], i) => <CuboidCollider key={i} args={[0.35, 1.4, 0.35]} position={[tx, 1.4, tz]} />)}
    </>
  )
}

function StaticPlatform({ p, visual }: { p: Platform; visual: boolean }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[p.x, p.top, p.z]}>
      <PlatformColliders p={p} />
      {visual && (p.kind === 'island' ? <IslandMesh p={p} /> : <SlabMesh p={p} />)}
    </RigidBody>
  )
}

function MovingPlatform({ p }: { p: Platform }) {
  const body = useRef<RapierRigidBody>(null)
  const col = useRef<RapierCollider>(null)
  const vel = useRef(new Vector3())
  const t = useRef(0)

  useEffect(() => {
    const c = col.current
    if (!c) return
    runtime.movers.set(c.handle, vel.current)
    return () => void runtime.movers.delete(c.handle)
  }, [])

  useFrame((_, dt) => {
    const m = p.moving!
    if (!body.current) return
    t.current += Math.min(dt, 0.05)
    const off = Math.sin(t.current * m.speed) * m.amp
    const v = Math.cos(t.current * m.speed) * m.amp * m.speed
    const pos = { x: p.x, y: p.top, z: p.z }
    pos[m.axis] += off
    vel.current.set(m.axis === 'x' ? v : 0, 0, m.axis === 'z' ? v : 0)
    body.current.setNextKinematicTranslation(pos)
  })

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[p.x, p.top, p.z]}>
      <CuboidCollider ref={col} args={[p.w / 2, p.h / 2, p.d / 2]} position={[0, -p.h / 2, 0]} friction={0} />
      <SlabMesh p={p} />
    </RigidBody>
  )
}

/** visual={false} — только коллайдеры: вид платформ рисует сцена сама (например, модель из Blender в лобби). */
export function Platforms({ platforms, visual = true }: { platforms: Platform[]; visual?: boolean }) {
  return (
    <>
      {platforms.map((p, i) => (p.moving ? <MovingPlatform key={i} p={p} /> : <StaticPlatform key={i} p={p} visual={visual} />))}
    </>
  )
}
