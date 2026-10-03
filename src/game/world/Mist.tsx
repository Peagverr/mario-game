import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, DoubleSide, Fog, ShaderMaterial, Vector3, type Group } from 'three'
import { atmo } from '../atmosphere/AtmosphereDriver'
import { runtime } from '../runtime'

/**
 * Море тумана под островами — вместо мультяшных облаков-шаров (они перекрывали остров при наклоне мира).
 * Несколько прозрачных слоёв с медленно плывущим шумом: дают глубину бездны и параллакс при движении головы.
 * Цвет — как у тумана, со стороны солнца теплее. Слои едут за героем, поэтому края никогда не видны.
 */

const VERT = `
varying vec2 vXZ;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const FRAG = `
uniform vec3 color; uniform vec3 sunTint; uniform vec3 sunDir; uniform vec3 center;
uniform float time; uniform float density; uniform float scale; uniform int octaves;
varying vec2 vXZ;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = vXZ * scale + vec2(time * 0.02, time * 0.013);
  float n = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { if (i >= octaves) break; n += a * vnoise(p); p = p * 2.03 + 3.7; a *= 0.5; }
  float r = length(vXZ - center.xz);
  float edge = 1.0 - smoothstep(90.0, 170.0, r);
  float alpha = clamp((n - 0.32) * 1.8, 0.0, 1.0) * density * edge;
  vec3 dir = normalize(vWorld - cameraPosition);
  float ts = max(dot(dir, sunDir), 0.0);
  vec3 c = color * (0.85 + 0.35 * n) + sunTint * ts * ts;
  gl_FragColor = vec4(c, alpha);
}`

const LAYERS = [
  { y: -7, density: 0.5, scale: 0.035, seed: 0 },
  { y: -13, density: 0.65, scale: 0.022, seed: 1 },
  { y: -22, density: 0.85, scale: 0.015, seed: 2 },
]

export function Mist() {
  const scene = useThree((s) => s.scene)
  const group = useRef<Group>(null)
  const low = runtime.lowQuality
  const layers = low ? LAYERS.slice(1, 2) : LAYERS
  const mats = useMemo(
    () =>
      layers.map(
        (l) =>
          new ShaderMaterial({
            uniforms: {
              color: { value: new Color() },
              sunTint: { value: new Color() },
              sunDir: { value: new Vector3() },
              center: { value: new Vector3() },
              time: { value: l.seed * 37 },
              density: { value: l.density },
              scale: { value: l.scale },
              octaves: { value: low ? 2 : 4 },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            fog: false,
          }),
      ),
    [layers, low],
  )

  useFrame(({ clock }) => {
    const g = group.current
    if (g) g.position.set(runtime.playerPos.x, 0, runtime.playerPos.z)
    const fogColor = scene.fog instanceof Fog ? scene.fog.color : atmo.skyBottom
    mats.forEach((m, i) => {
      const u = m.uniforms
      u.time.value = clock.elapsedTime + layers[i].seed * 37
      u.color.value.copy(fogColor).lerp(atmo.skyHorizon, 0.25 + i * 0.1)
      u.sunTint.value.copy(atmo.sunColor).multiplyScalar(0.5 * atmo.sunGlow)
      u.sunDir.value.copy(atmo.sunDir)
      u.center.value.set(runtime.playerPos.x, 0, runtime.playerPos.z)
    })
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
