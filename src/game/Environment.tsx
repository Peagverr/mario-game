import { Outlines } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BackSide, Color, InstancedMesh, Object3D, type DirectionalLight, type Group } from 'three'
import { palette } from './palette'
import { runtime } from './runtime'
import { toonGradient } from './toon'

/** Небо-градиент: сверху голубое, у горизонта тёплое. Туман того же цвета — мир «растворяется» вдали. */
export function Sky() {
  const uniforms = useMemo(
    () => ({
      top: { value: new Color(palette.skyTop) },
      horizon: { value: new Color(palette.skyHorizon) },
      bottom: { value: new Color(palette.skyBottom) },
    }),
    [],
  )
  const ref = useRef<Group>(null)
  useFrame(() => ref.current?.position.copy(runtime.playerPos))
  return (
    <group ref={ref}>
      <mesh scale={300}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial
          side={BackSide}
          depthWrite={false}
          fog={false}
          uniforms={uniforms}
          vertexShader={`varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
          fragmentShader={`uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos;
            void main(){
              float y = vPos.y;
              vec3 c = y > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.55, y)) : mix(horizon, bottom, smoothstep(0.0, -0.45, y));
              gl_FragColor = vec4(c, 1.0);
            }`}
        />
      </mesh>
    </group>
  )
}

/** Солнце следует за героем, чтобы тени всегда были чёткими рядом с ним. */
export function Lights() {
  const sun = useRef<DirectionalLight>(null)
  useFrame(() => {
    const s = sun.current
    if (!s) return
    s.position.set(runtime.playerPos.x + 8, runtime.playerPos.y + 16, runtime.playerPos.z + 6)
    s.target.position.copy(runtime.playerPos)
    s.target.updateMatrixWorld()
  })
  return (
    <>
      <hemisphereLight args={['#dff0ff', '#ffd9a8', 1.1]} />
      <directionalLight
        ref={sun}
        intensity={2.4}
        color="#fff1d6"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
    </>
  )
}

/** Облака из шаров — плывут внизу и по сторонам, дают ощущение высоты. */
export function Clouds() {
  const clouds = useMemo(() => {
    const rnd = mulberry32(7)
    return Array.from({ length: 16 }, () => ({
      x: -30 + rnd() * 60,
      y: -9 + rnd() * 16 * (rnd() > 0.6 ? 1 : -0.4),
      z: -40 + rnd() * 50,
      s: 1 + rnd() * 1.6,
      speed: 0.3 + rnd() * 0.5,
      puffs: Array.from({ length: 4 }, (_, i) => [i * 0.9 - 1.3, rnd() * 0.4, rnd() * 0.6 - 0.3, 0.7 + rnd() * 0.5] as const),
    }))
  }, [])
  const refs = useRef<(Group | null)[]>([])
  useFrame((_, dt) => {
    clouds.forEach((c, i) => {
      const g = refs.current[i]
      if (!g) return
      c.x += c.speed * dt
      if (c.x > 35) c.x = -35
      g.position.set(c.x, c.y, c.z)
    })
  })
  return (
    <>
      {clouds.map((c, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)} scale={c.s}>
          {c.puffs.map(([x, y, z, r], j) => (
            <mesh key={j} position={[x, y, z]}>
              <sphereGeometry args={[r, 12, 10]} />
              <meshToonMaterial color={palette.cloud} gradientMap={toonGradient} />
              <Outlines thickness={0.02} color="#c9d8ea" />
            </mesh>
          ))}
        </group>
      ))}
    </>
  )
}

/** Частицы: звёздочки при сборе, пыль при приземлении. Один InstancedMesh на все частицы. */
const MAX_PARTICLES = 200
export function Bursts() {
  const mesh = useRef<InstancedMesh>(null)
  const parts = useMemo(
    () => Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, color: new Color() })),
    [],
  )
  const dummy = useMemo(() => new Object3D(), [])
  const next = useRef(0)

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const m = mesh.current
    if (!m) return
    while (runtime.bursts.length) {
      const b = runtime.bursts.shift()!
      for (let i = 0; i < b.count; i++) {
        const p = parts[next.current]
        next.current = (next.current + 1) % MAX_PARTICLES
        const a = Math.random() * Math.PI * 2
        const up = 0.4 + Math.random()
        p.life = 1
        p.x = b.pos.x
        p.y = b.pos.y
        p.z = b.pos.z
        p.vx = Math.cos(a) * b.speed * (0.4 + Math.random() * 0.6)
        p.vz = Math.sin(a) * b.speed * (0.4 + Math.random() * 0.6)
        p.vy = up * b.speed * 0.8
        p.color.set(b.color)
      }
    }
    parts.forEach((p, i) => {
      if (p.life > 0) {
        p.life -= dt * 1.6
        p.vy -= 12 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
      }
      const sc = Math.max(0, p.life) * 0.18
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(p.life * 6, p.life * 4, 0)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, p.color)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

/** Детерминированный генератор случайных чисел — облака всегда на одних местах. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
