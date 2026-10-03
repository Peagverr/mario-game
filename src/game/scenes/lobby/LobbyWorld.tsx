import { Sparkles, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  Mesh,
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
  type MeshStandardMaterial,
} from 'three'
import { runtime } from '../../runtime'
import { LEVELS } from '../index'
import { LightShafts } from '../../LightShafts'
import { hazy } from '../../world/haze'
import { Surroundings } from '../../world/Surroundings'
import { warmWindows } from '../../world/Towers'
import { GlowPools } from '../../world/GlowPools'

/**
 * Вид лобби из Blender (art/lobby.blend → public/models/lobby.glb): каменный остров с мхом и травой,
 * арки-порталы, колонны, фонари, башни-руины в дымке. Коллайдеры — прежние, в Lobby.tsx.
 * Координаты модели совпадают с игрой: верх острова на y = 0.
 */
const URL = `${import.meta.env.BASE_URL}models/lobby.glb`

/** Огоньки фонарей (там же стоят модели фонарей). */
const LANTERNS: [number, number, number][] = [
  [-7.2, 0.26, 5.3],
  [7.2, 2.33, 3.6],
  [-3, 0.26, -4.6],
  [3, 0.26, -4.7],
  [-7.6, 0.26, -3.8],
]
/** Лучи солнца падают на остров между арками. */
const SHAFTS = [
  { at: [3.6, 0, -1.2] as [number, number, number], length: 24, width: 0.9, seed: 1 },
  { at: [6.8, 0, 1.8] as [number, number, number], length: 22, width: 1.1, seed: 2 },
  { at: [-1.2, 0, -2.6] as [number, number, number], length: 26, width: 0.8, seed: 3 },
]
const PORTALS: [number, number][] = [
  [-5.2, -3.6],
  [0, -4.2],
  [5.2, -3.6],
]

const FILM_VERT = `
uniform vec3 center;
varying vec2 vUv;
void main() {
  vUv = vec2(position.x - center.x, position.y - center.y) / vec2(0.8, 1.16);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
// Плёнка портала: медленный вихрь света, ярче к краю.
const FILM_FRAG = `
uniform vec3 color; uniform float time;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  float swirl = sin(a * 3.0 + r * 9.0 - time * 1.6) * 0.5 + 0.5;
  float rim = smoothstep(0.55, 1.0, r);
  float glow = (0.18 + 0.35 * swirl * (1.0 - r * 0.6) + rim * 0.7) * (1.0 - smoothstep(0.92, 1.02, r));
  gl_FragColor = vec4(color * glow * 2.6, glow);
}`

const FAR_HAZE = { far: 0.5, low: 0.7, nearFade: 34 }

/**
 * Разделить меш по расстоянию от центра острова: в исходном остаются треугольники ближе r (стена и скалы острова),
 * дальние уходят в новый меш (рядом, тот же родитель) с копией материала. Возвращает новый меш.
 */
function splitFar(m: Mesh, r: number) {
  const g = m.geometry
  const pos = g.attributes.position
  const idx = g.index
  const n = idx ? idx.count : pos.count
  const near: number[] = []
  const far: number[] = []
  const v = new Vector3()
  for (let i = 0; i < n; i += 3) {
    let cx = 0
    let cz = 0
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld)
      cx += v.x / 3
      cz += v.z / 3
    }
    const dst = cx * cx + cz * cz < r * r ? near : far
    for (let k = 0; k < 3; k++) dst.push(idx ? idx.getX(i + k) : i + k)
  }
  const fg = g.clone()
  fg.setIndex(far)
  g.setIndex(near)
  const mats = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone()
  const fm = new Mesh(fg, mats)
  fm.name = 'BackdropFar'
  fm.position.copy(m.position)
  fm.quaternion.copy(m.quaternion)
  fm.scale.copy(m.scale)
  m.parent?.add(fm)
  return fm
}

/** Свет фонарей и порталов на камне (вместо точечных источников). */
/** Список считается при первом показе: LEVELS при загрузке модуля ещё не готов (циклический импорт). */
const pools = () => [
  ...LANTERNS.map((p) => ({ at: [p[0], 0, p[2]] as [number, number, number], color: '#ffa04a', radius: 2.6, strength: 0.55, halo: 0.9, haloAt: p })),
  ...PORTALS.map(([x, z], i) => ({ at: [x, 0, z + 0.9] as [number, number, number], color: LEVELS[i]?.color ?? '#b9bfd3', radius: 2.4, strength: 0.4 })),
]

export function LobbyWorld() {
  const { scene } = useGLTF(URL)
  const films = useMemo(() => {
    const out: ShaderMaterial[] = []
    // Куски фона в модели смешаны: рядом — стена и скалы острова, дальше 16 м — башни и мосты.
    // Делим: дальнюю часть — в отдельный меш со своей дымкой и растворением у камеры.
    scene.updateMatrixWorld(true)
    const splits: Mesh[] = []
    scene.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && m.name.startsWith('Backdrop') && !(Array.isArray(m.material) ? m.material : [m.material]).some((x) => x.name === 'TowerWindow')) splits.push(m)
    })
    for (const m of splits) {
      const farMesh = splitFar(m, 16)
      const mats = (Array.isArray(farMesh.material) ? farMesh.material : [farMesh.material]) as MeshStandardMaterial[]
      for (const mt of mats) hazy(mt, FAR_HAZE)
    }
    scene.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const name = m.name
      m.castShadow = !/Grass|Film|Flame|Backdrop/.test(name)
      m.receiveShadow = !/Film|Flame/.test(name)
      const slot = Number(name.slice(-1))
      if (name.startsWith('PortalRing')) {
        m.material = new MeshBasicMaterial({ color: new Color(LEVELS[slot]?.color ?? '#b9bfd3').multiplyScalar(4), toneMapped: false })
      } else if (name.startsWith('PortalFilm')) {
        m.geometry.computeBoundingBox()
        const c = m.geometry.boundingBox!.getCenter(new Vector3())
        const mat = new ShaderMaterial({
          uniforms: { color: { value: new Color(LEVELS[slot]?.color ?? '#b9bfd3') }, time: { value: 0 }, center: { value: c } },
          vertexShader: FILM_VERT,
          fragmentShader: FILM_FRAG,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
          toneMapped: false,
        })
        m.material = mat
        out.push(mat)
      } else if (name.startsWith('Flames')) {
        m.material = new MeshBasicMaterial({ color: new Color(1, 0.62, 0.28).multiplyScalar(3), toneMapped: false })
      } else {
        // Фото-текстуры камня под острым углом камеры: анизотропия держит их чёткими.
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]
        for (const mt of mats) {
          for (const t of [mt.map, mt.normalMap, mt.roughnessMap]) if (t) t.anisotropy = 8
          if (name === 'Grass') {
            mt.side = DoubleSide
            mt.color.setScalar(2.4) // цвета травы в вершинах тёмные — в сумерках иначе почти чёрная
          }
          if (mt.name === 'forest_leaves_02') mt.color.multiply(new Color(0.55, 0.62, 0.45))
          if (mt.name === 'stone_brick_wall_001') mt.color.multiplyScalar(1.9) // бока острова: иначе в сумерках чёрная дыра
          // башни, мосты и скалы фона: дымка по глубине и растворение у камеры (раньше дымка не применялась —
          // имя куска «Backdrop_N», и туман сцены заливал башни сплошным голубым)
          if (mt.name === 'TowerWindow') warmWindows(mt)
          if (name.startsWith('Backdrop') && name !== 'BackdropFar') hazy(mt, mt.name === 'TowerWindow' ? FAR_HAZE : { far: 0.9, low: 0.85 })
        }
      }
    })
    return out
  }, [scene])

  useFrame(({ clock }) => {
    for (const f of films) f.uniforms.time.value = clock.elapsedTime
  })

  const low = runtime.lowQuality
  const poolList = useMemo(pools, [])
  return (
    <>
      <primitive object={scene} />
      {/* Свет фонарей и порталов — пятна на камне и ореолы (дешевле точечных источников). */}
      <GlowPools pools={poolList} />
      <LightShafts shafts={SHAFTS} />
      {/* Средний план со всех сторон: островки с руинами. */}
      <Surroundings center={[0, 0, 0]} seed={3} />
      {/* Пылинки и светлячки над островом. */}
      <Sparkles count={low ? 25 : 70} scale={[22, 5, 16]} position={[0, 2.2, 0]} size={2.2} speed={0.25} opacity={0.7} color="#ffd59a" />
    </>
  )
}

useGLTF.preload(URL)
