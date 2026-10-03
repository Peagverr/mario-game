import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { DataTexture, DoubleSide, LinearFilter, RepeatWrapping, ShaderMaterial, type Group } from 'three'
import { runtime } from '../runtime'
import { PANO_GLSL, panoUniforms } from './skyPano'

/**
 * Море тумана под островами — слои с медленно плывущим шумом между 3D-миром и панорамой фона:
 * дают глубину бездны и параллакс при движении головы. Цвет — из панорамы в том же направлении,
 * поэтому туман сливается с облаками на фоне. Шум — из маленькой заранее посчитанной текстуры
 * (две выборки на слой), а не считается в каждом пикселе: дешёво для встроенной видеокарты.
 */

/** Бесшовный шум 128×128 (сумма синусов разных частот) — считается один раз при загрузке. */
function noiseTexture() {
  const N = 128
  const data = new Uint8Array(N * N * 4)
  const TAU = Math.PI * 2
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = (x / N) * TAU
      const v = (y / N) * TAU
      let n = 0
      n += Math.sin(u * 1 + Math.cos(v * 2) * 1.3) * 0.35 + Math.cos(v * 1 + Math.sin(u * 2) * 1.1) * 0.35
      n += Math.sin(u * 3 + v * 2 + Math.sin(v * 5)) * 0.18 + Math.cos(u * 5 - v * 4) * 0.1
      n += Math.sin(u * 9 + Math.cos(v * 7) * 2) * 0.06 + Math.cos(v * 11 - u * 3) * 0.05
      const val = Math.max(0, Math.min(255, Math.round((n * 0.5 + 0.5) * 255)))
      const i = (y * N + x) * 4
      data[i] = data[i + 1] = data[i + 2] = val
      data[i + 3] = 255
    }
  const t = new DataTexture(data, N, N)
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = t.minFilter = LinearFilter
  t.needsUpdate = true
  return t
}

const VERT = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const FRAG = `
${PANO_GLSL}
uniform sampler2D noise; uniform vec3 center;
uniform float time; uniform float density; uniform float scale;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz * scale;
  float n = texture2D(noise, p + vec2(time * 0.004, time * 0.0027)).r * 0.65
          + texture2D(noise, p * 2.7 - vec2(time * 0.006, -time * 0.004)).r * 0.35;
  float r = length(vWorld.xz - center.xz);
  float edge = 1.0 - smoothstep(90.0, 170.0, r);
  float alpha = clamp((n - 0.38) * 2.2, 0.0, 1.0) * density * edge;
  vec3 c = panoSample(vWorld - cameraPosition, 4.0) * (0.9 + 0.35 * n);
  gl_FragColor = vec4(c, alpha);
}`

const LAYERS = [
  { y: -7, density: 0.45, scale: 0.012, seed: 0 },
  { y: -13, density: 0.6, scale: 0.008, seed: 1 },
  { y: -22, density: 0.8, scale: 0.005, seed: 2 },
]

const noise = noiseTexture()

export function Mist() {
  const group = useRef<Group>(null)
  const low = runtime.lowQuality
  const layers = low ? LAYERS.slice(1, 2) : LAYERS
  const mats = useMemo(
    () =>
      layers.map(
        (l) =>
          new ShaderMaterial({
            uniforms: {
              ...panoUniforms,
              noise: { value: noise },
              center: { value: runtime.playerPos },
              time: { value: l.seed * 37 },
              density: { value: l.density },
              scale: { value: l.scale },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            fog: false,
          }),
      ),
    [layers],
  )

  useFrame(({ clock }) => {
    const g = group.current
    if (g) g.position.set(runtime.playerPos.x, 0, runtime.playerPos.z)
    mats.forEach((m, i) => void (m.uniforms.time.value = clock.elapsedTime + layers[i].seed * 37))
  })

  return (
    <group ref={group}>
      {layers.map((l, i) => (
        <mesh key={i} position={[0, l.y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats[i]} renderOrder={-0.5}>
          <planeGeometry args={[360, 360, 1, 1]} />
        </mesh>
      ))}
    </group>
  )
}
