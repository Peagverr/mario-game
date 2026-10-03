import { Sparkles, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
  type Mesh,
  type MeshStandardMaterial,
} from 'three'
import { atmo } from '../../atmosphere/AtmosphereDriver'
import { runtime } from '../../runtime'
import { LEVELS } from '../index'
import { LightShafts } from '../../LightShafts'

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
  { at: [3.6, 0, -1.2] as [number, number, number], length: 26, width: 0.9, seed: 1 },
  { at: [6.8, 0, 1.8] as [number, number, number], length: 24, width: 1.2, seed: 2 },
  { at: [-1.2, 0, -2.6] as [number, number, number], length: 28, width: 0.7, seed: 3 },
  { at: [1.2, 0, 2.6] as [number, number, number], length: 22, width: 1.0, seed: 4 },
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

/** Общие для дымки: направление на солнце в координатах камеры и его цвет (обновляются каждый кадр). */
const haze = {
  sunView: { value: new Vector3(0, 0, -1) },
  sunTint: { value: new Color() },
}

/**
 * Дальняя дымка: обычный туман целиком съедает башни за 60+ м. Здесь он доходит максимум до 88%
 * и растянут дальше — башни остаются силуэтами. Плюс туман по высоте: чем ниже, тем гуще. Цвет дымки теплеет в сторону солнца
 * (приём «туман с рассеянием солнца», iquilezles.org/articles/fog): слева синяя глубина, справа зарево.
 */
function hazy(mt: MeshStandardMaterial) {
  mt.onBeforeCompile = (shader) => {
    shader.uniforms.sunView = haze.sunView
    shader.uniforms.sunTint = haze.sunTint
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nuniform vec3 sunView; uniform vec3 sunTint;')
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          // по расстоянию + по высоте: низ острова и скалы тонут в дымке бездны
          float hz = max(smoothstep(fogNear, fogFar * 2.6, vFogDepth) * 0.88, (1.0 - smoothstep(-12.0, -0.5, vHzY)) * 0.85);
          float ts = max(dot(normalize(-vViewPosition), sunView), 0.0);
          float toSun = ts * ts * ts;
          vec3 hc = fogColor + sunTint * toSun;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hc, hz);
        #endif`,
      )
  }
  mt.customProgramCacheKey = () => 'lobby-haze'
}

export function LobbyWorld() {
  const { scene } = useGLTF(URL)
  const films = useMemo(() => {
    const out: ShaderMaterial[] = []
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
          if (name === 'Backdrop') hazy(mt)
        }
      }
    })
    return out
  }, [scene])

  useFrame(({ clock, camera }) => {
    for (const f of films) f.uniforms.time.value = clock.elapsedTime
    haze.sunView.value.copy(atmo.sunDir).transformDirection(camera.matrixWorldInverse)
    haze.sunTint.value.copy(atmo.sunColor).multiplyScalar(0.55 * atmo.sunGlow)
  })

  const low = runtime.lowQuality
  return (
    <>
      <primitive object={scene} />
      {!low &&
        LANTERNS.map((p, i) => <pointLight key={i} position={p} color="#ffa35a" intensity={7} distance={7} decay={1.6} />)}
      {!low &&
        PORTALS.map(([x, z], i) => (
          <pointLight key={`p${i}`} position={[x, 1.6, z + 0.7]} color={LEVELS[i]?.color ?? '#b9bfd3'} intensity={6} distance={6} decay={1.6} />
        ))}
      <LightShafts shafts={SHAFTS} />
      {/* Пылинки и светлячки над островом. */}
      <Sparkles count={low ? 25 : 70} scale={[22, 5, 16]} position={[0, 2.2, 0]} size={2.2} speed={0.25} opacity={0.7} color="#ffd59a" />
    </>
  )
}

useGLTF.preload(URL)
