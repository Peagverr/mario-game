import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BackSide, Color, InstancedMesh, Object3D, Vector3, type DirectionalLight, type Group, type HemisphereLight, type ShaderMaterial } from 'three'
import { atmo } from './atmosphere/AtmosphereDriver'
import { runtime } from './runtime'

/** Луна ночью — сверху слева, чтобы не спорить с местом восхода (справа позади островов). */
const MOON_DIR = new Vector3(-0.55, 0.42, -0.72).normalize()

const SKY_VERT = `varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunGlow;
uniform vec3 moonDir; uniform float stars; uniform float time;
varying vec3 vPos;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

void main() {
  vec3 d = normalize(vPos);
  float y = d.y;
  vec3 c = y > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.55, y)) : mix(horizon, bottom, smoothstep(0.0, -0.45, y));

  // Солнце: тёплое свечение у горизонта (ещё до восхода), корона и диск.
  float sd = max(dot(d, sunDir), 0.0);
  float band = exp(-abs(y) * 6.0);
  c += sunColor * sunGlow * (pow(sd, 5.0) * 0.35 * (0.4 + band) + pow(sd, 48.0) * 0.8);
  c += sunColor * sunGlow * smoothstep(0.99935, 0.99965, sd) * 5.0;

  // Звёзды: по точке на ячейку неба, мерцают; к горизонту и к рассвету гаснут.
  if (stars > 0.001) {
    vec3 p = d * 180.0;
    vec3 id = floor(p);
    float h = hash(id);
    float s = step(0.993, h) * smoothstep(0.45, 0.0, length(fract(p) - 0.5));
    float tw = 0.65 + 0.35 * sin(time * (1.5 + h * 4.0) + h * 40.0);
    c += vec3(0.85, 0.9, 1.0) * s * tw * stars * smoothstep(-0.02, 0.25, y) * 2.2;
  }

  // Луна: маленький холодный диск с ореолом, только ночью.
  float md = max(dot(d, moonDir), 0.0);
  c += vec3(0.75, 0.82, 1.0) * stars * (smoothstep(0.99955, 0.99975, md) * 2.4 + pow(md, 300.0) * 0.25);

  gl_FragColor = vec4(c, 1.0);
}`

/** Небо со звёздами, луной и солнцем — цвета от времени суток (atmosphere). Едет за героем: горизонт всегда далеко. */
export function Sky() {
  const uniforms = useMemo(
    () => ({
      top: { value: new Color() },
      horizon: { value: new Color() },
      bottom: { value: new Color() },
      sunDir: { value: new Vector3() },
      sunColor: { value: new Color() },
      sunGlow: { value: 0 },
      moonDir: { value: MOON_DIR },
      stars: { value: 0 },
      time: { value: 0 },
    }),
    [],
  )
  const ref = useRef<Group>(null)
  const mat = useRef<ShaderMaterial>(null)
  useFrame(({ clock }) => {
    ref.current?.position.copy(runtime.playerPos)
    const u = mat.current?.uniforms
    if (!u) return
    u.top.value.copy(atmo.skyTop)
    u.horizon.value.copy(atmo.skyHorizon)
    u.bottom.value.copy(atmo.skyBottom)
    u.sunDir.value.copy(atmo.sunDir)
    u.sunColor.value.copy(atmo.sunColor)
    u.sunGlow.value = atmo.sunGlow
    u.stars.value = atmo.stars
    u.time.value = clock.elapsedTime
  })
  return (
    <group ref={ref}>
      <mesh scale={300} renderOrder={-1}>
        <sphereGeometry args={[1, 48, 24]} />
        <shaderMaterial ref={mat} side={BackSide} depthWrite={false} fog={false} uniforms={uniforms} vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} />
      </mesh>
    </group>
  )
}

/**
 * Свет от времени суток: ключевой (ночью луна, к рассвету солнце) + мягкий свет неба и земли.
 * Ключевой свет следует за героем, чтобы тени всегда были чёткими рядом с ним.
 */
const rimDir = new Vector3()

export function Lights() {
  const sun = useRef<DirectionalLight>(null)
  const rim = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  useFrame(() => {
    const r = rim.current
    if (r) {
      // Контровой свет: со стороны солнца, но поднят (~30°) — чтобы золотил верх камней, а не только бока.
      rimDir.copy(atmo.sunDir)
      rimDir.y = Math.max(rimDir.y, 0.6)
      r.position.copy(runtime.playerPos).addScaledVector(rimDir.normalize(), 20)
      r.target.position.copy(runtime.playerPos)
      r.target.updateMatrixWorld()
      r.color.copy(atmo.sunColor)
      r.intensity = atmo.rimIntensity
    }
    const s = sun.current
    if (!s) return
    s.position.copy(runtime.playerPos).addScaledVector(atmo.keyDir, 20)
    s.target.position.copy(runtime.playerPos)
    s.target.updateMatrixWorld()
    s.color.copy(atmo.keyColor)
    s.intensity = atmo.keyIntensity
    const h = hemi.current
    if (h) {
      h.color.copy(atmo.hemiSky)
      h.groundColor.copy(atmo.hemiGround)
      h.intensity = atmo.hemiIntensity
    }
  })
  return (
    <>
      <hemisphereLight ref={hemi} />
      <directionalLight ref={rim} />
      <directionalLight
        ref={sun}
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
