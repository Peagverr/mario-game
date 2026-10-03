import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, Color, DoubleSide, Quaternion, ShaderMaterial, Vector3, type Mesh } from 'three'
import { atmo } from './atmosphere/AtmosphereDriver'
import { runtime } from './runtime'

/**
 * Лучи солнца сквозь руины — как на референсе. Не настоящий объёмный свет (дорого на встроенной видеокарте),
 * а приём из игр: открытые конусы со светящимся градиентом. Края гаснут по углу к камере, концы — по длине,
 * поэтому луч выглядит мягким столбом света с любой стороны. Яркость и цвет — от времени суток.
 */

const VERT = `
varying float vAlong;
varying float vEdge;
void main() {
  vAlong = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vEdge = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`

const FRAG = `
uniform vec3 color; uniform float strength; uniform float time; uniform float seed;
varying float vAlong;
varying float vEdge;
void main() {
  float ends = smoothstep(0.0, 0.35, vAlong) * (1.0 - smoothstep(0.55, 1.0, vAlong));
  // Ограничить именно здесь: при сглаживании (MSAA) значения на краю треугольника выходят за 0..1,
  // и корень из отрицательного даёт NaN — свечение размазывает его чёрным на весь экран.
  float e = clamp(vEdge, 0.0, 1.0);
  float soft = e * e * sqrt(e);
  float flicker = 0.75 + 0.25 * sin(time * 0.6 + seed * 7.0) * sin(time * 0.37 + seed * 3.0);
  float a = ends * soft * flicker * strength;
  gl_FragColor = vec4(color * a, a);
}`

const UP = new Vector3(0, 1, 0)
const WARM = new Color('#ffd9a0')

type Shaft = { at: [number, number, number]; length: number; width: number; seed: number }

export function LightShafts({ shafts, tilt = 0.55 }: { shafts: Shaft[]; tilt?: number }) {
  const mats = useMemo(
    () =>
      shafts.map(
        (s) =>
          new ShaderMaterial({
            uniforms: { color: { value: new Color() }, strength: { value: 0 }, time: { value: 0 }, seed: { value: s.seed } },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
            fog: false,
            toneMapped: false,
          }),
      ),
    [shafts],
  )
  const meshes = useRef<(Mesh | null)[]>([])
  const dir = useMemo(() => new Vector3(), [])
  const q = useMemo(() => new Quaternion(), [])

  useFrame(({ clock }) => {
    // Ось луча — к солнцу (по сторонам света), но поднята: так лучи падают на остров, а не стелются.
    const a = (tilt * Math.PI) / 2
    dir.set(atmo.sunDir.x, 0, atmo.sunDir.z).normalize().multiplyScalar(Math.cos(a)).setY(Math.sin(a)).normalize()
    q.setFromUnitVectors(UP, dir)
    shafts.forEach((s, i) => {
      const m = meshes.current[i]
      if (!m) return
      m.quaternion.copy(q)
      m.position.set(...s.at).addScaledVector(dir, s.length / 2)
    })
    for (const m of mats) {
      m.uniforms.time.value = clock.elapsedTime
      // Лучи светлее солнца у горизонта: красный закатный цвет в дымке читается как грязь.
      m.uniforms.color.value.copy(atmo.sunColor).lerp(WARM, 0.7).multiplyScalar(0.8)
      m.uniforms.strength.value = (0.75 + atmo.sunGlow * 0.25) * (runtime.lowQuality ? 0.8 : 1)
    }
  })

  return (
    <>
      {shafts.map((s, i) => (
        <mesh key={i} ref={(m) => void (meshes.current[i] = m)} material={mats[i]} renderOrder={5} frustumCulled={false}>
          <cylinderGeometry args={[s.width * 1.6, s.width, s.length, 20, 1, true]} />
        </mesh>
      ))}
    </>
  )
}
