import { Outlines } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useMemo, useRef, useState } from 'react'
import { ExtrudeGeometry, Shape, Vector3, type Group } from 'three'
import { useGame } from '../../../shared/gameStore'
import { palette } from '../../palette'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { toonGradient } from '../../toon'

function starGeometry() {
  const s = new Shape()
  const spikes = 5
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.22
    const a = (i / (spikes * 2)) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 })
  g.center()
  return g
}

function Star({ position }: { position: [number, number, number] }) {
  const [taken, setTaken] = useState(false)
  const ref = useRef<Group>(null)
  const geo = useMemo(starGeometry, [])
  const seed = useMemo(() => Math.random() * 10, [])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.elapsedTime + seed
    ref.current.rotation.y = t * 1.8
    ref.current.position.y = Math.sin(t * 2) * 0.12
  })

  if (taken) return null
  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      <CuboidCollider
        sensor
        args={[0.5, 0.5, 0.5]}
        onIntersectionEnter={({ other }) => {
          if (other.rigidBodyObject?.name !== 'player' || taken) return
          setTaken(true)
          useGame.getState().collectStar()
          burst(new Vector3(...position), palette.star, 18, 5)
          sfx.star()
        }}
      />
      <group ref={ref}>
        <mesh geometry={geo} castShadow>
          <meshToonMaterial color={palette.star} emissive={palette.star} emissiveIntensity={0.9} gradientMap={toonGradient} />
          <Outlines thickness={0.03} color={palette.ink} />
        </mesh>
      </group>
    </RigidBody>
  )
}

export function Stars({ positions }: { positions: [number, number, number][] }) {
  return (
    <>
      {positions.map((p, i) => (
        <Star key={i} position={p} />
      ))}
    </>
  )
}

/** Флаг финиша: дойти до него = закончить уровень. */
export function Goal({ position }: { position: [number, number, number] }) {
  const flag = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 3) * 0.25
  })
  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      <CuboidCollider
        sensor
        args={[0.9, 1.5, 0.9]}
        position={[0, 1.5, 0]}
        onIntersectionEnter={({ other }) => {
          if (other.rigidBodyObject?.name !== 'player') return
          const g = useGame.getState()
          if (g.phase !== 'playing') return
          burst(runtime.playerPos.clone().setY(runtime.playerPos.y + 1), palette.flag, 40, 7)
          sfx.finish()
          g.finishRun()
        }}
      />
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 3.2, 8]} />
        <meshToonMaterial color={palette.heroCream} gradientMap={toonGradient} />
        <Outlines thickness={0.03} color={palette.ink} />
      </mesh>
      <mesh position={[0, 3.3, 0]}>
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshToonMaterial color={palette.star} emissive={palette.star} emissiveIntensity={0.8} gradientMap={toonGradient} />
      </mesh>
      <group ref={flag} position={[0, 2.8, 0]}>
        <mesh position={[0.55, 0, 0]} castShadow>
          <boxGeometry args={[1.1, 0.7, 0.05]} />
          <meshToonMaterial color={palette.flag} gradientMap={toonGradient} />
          <Outlines thickness={0.03} color={palette.ink} />
        </mesh>
      </group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.15, 32]} />
        <meshBasicMaterial color={palette.star} transparent opacity={0.8} />
      </mesh>
    </RigidBody>
  )
}
