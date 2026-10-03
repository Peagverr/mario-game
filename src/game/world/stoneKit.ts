import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hazy } from './haze'

/**
 * Набор «каменного мира» для уровней — тот же камень, кладка, скалы и доски, что в лобби из Blender
 * (фото-текстуры Poly Haven, CC0, лежат в public/textures). Материалы общие на всю игру:
 * один материал — одна программа шейдера, сколько бы островов ни было.
 * UV считаются «по миру» (triplanar по граням): текстура одного размера на любом блоке, без растяжения.
 */

const BASE = `${import.meta.env.BASE_URL}textures/`
const loader = new TextureLoader()

function tex(name: string, color: boolean): Texture {
  const t = loader.load(`${BASE}${name}.jpg`)
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  if (color) t.colorSpace = SRGBColorSpace
  return t
}

function stone(name: string, tint: [number, number, number], extra: Partial<MeshStandardMaterial> = {}) {
  const m = new MeshStandardMaterial({
    map: tex(`${name}_diff`, true),
    normalMap: tex(`${name}_nor`, false),
    roughnessMap: tex(`${name}_rough`, false),
    color: new Color(...tint),
    roughness: 1,
    metalness: 0,
  })
  Object.assign(m, extra)
  m.name = name
  return m
}

let kit: ReturnType<typeof makeKit> | null = null
function makeKit() {
  return {
    /** Верх плит и блоки — тот же тёмный камень, что плиты лобби. */
    rock: stone('rock', [0.55, 0.56, 0.62]),
    /** Бока островов и стены двориков — кладка. */
    wall: stone('wall', [0.95, 0.95, 1.04]),
    /** Скалы-«корни» под островами — тонут в дымке бездны. */
    cliff: hazy(stone('cliff', [0.6, 0.6, 0.65])),
    planks: stone('planks', [0.8, 0.72, 0.66]),
    /** Мох в щелях между плитами. */
    moss: stone('moss', [0.45, 0.52, 0.36]),
  }
}
let far: { rock: MeshStandardMaterial; wall: MeshStandardMaterial; cliff: MeshStandardMaterial; moss: MeshStandardMaterial } | null = null
/**
 * Те же камень, кладка и скалы для среднего плана (Surroundings): дымка слабее (иначе островки — плоские синие
 * силуэты) и растворение у камеры — при повороте и отдалении камера может подлететь к островку вплотную.
 */
export function farKit() {
  const k = stoneKit()
  const mid = { far: 0.4, low: 0.55, rim: 0, nearFade: 26 }
  return (far ??= {
    rock: hazy(k.rock.clone(), mid),
    wall: hazy(k.wall.clone(), mid),
    cliff: hazy(k.cliff.clone(), mid),
    moss: hazy(k.moss.clone(), mid),
  })
}
/** Материалы мира (создаются один раз). */
export function stoneKit() {
  return (kit ??= makeKit())
}

/** Размер текстуры в метрах для каждого материала (как в Blender). */
export const TILE = { rock: 2, wall: 2.5, cliff: 6, planks: 2, moss: 3 } as const

/**
 * UV «по миру»: каждая вершина проецируется на плоскость, перпендикулярную главной оси её нормали.
 * offset — сдвиг узора, чтобы соседние одинаковые блоки не выглядели копиями.
 */
export function worldUV(geo: BufferGeometry, tile: number, offset: [number, number, number] = [0, 0, 0]) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset[0]
    const y = pos.getY(i) + offset[1]
    const z = pos.getZ(i) + offset[2]
    const ax = Math.abs(nor.getX(i))
    const ay = Math.abs(nor.getY(i))
    const az = Math.abs(nor.getZ(i))
    let u: number
    let v: number
    if (ay >= ax && ay >= az) [u, v] = [x, z]
    else if (ax >= az) [u, v] = [z, y]
    else [u, v] = [x, y]
    uv[i * 2] = u / tile
    uv[i * 2 + 1] = v / tile
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  return geo
}

/** Детерминированный «шум» — одинаковая форма скал при каждом запуске. */
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
function noise3(p: Vector3) {
  // сумма двух октав синусов — дёшево и без швов
  return (
    Math.sin(p.x * 1.7 + p.z * 0.9) * Math.cos(p.y * 1.3 - p.x * 0.6) * 0.6 +
    Math.sin(p.x * 3.9 - p.y * 2.7 + p.z * 3.1) * 0.25 +
    (hash3(Math.round(p.x * 3), Math.round(p.y * 3), Math.round(p.z * 3)) - 0.5) * 0.15
  )
}

/** Блок камня со скруглёнными рёбрами (центр в нуле). */
export function stoneBlock(w: number, h: number, d: number, tile: number, seed = 0, radius = 0.08) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) * 0.3))
  return worldUV(g, tile, [seed * 0.37, seed * 0.11, seed * 0.73])
}

/**
 * Скала-«корень» под островом: плоский верх (y = 0) размером w×d, ниже сужается в неровный клык глубиной depth.
 */
export function rockRoot(w: number, d: number, depth: number, seed: number) {
  const g = new IcosahedronGeometry(1, 3)
  const p = g.attributes.position
  const v = new Vector3()
  const sv = new Vector3(seed * 3.1, seed * 1.7, seed * 2.3)
  const TOP = 0.3
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const len = Math.hypot(v.x, v.z) || 1
    const dx = v.x / len
    const dz = v.z / len
    if (v.y >= TOP) {
      // верхняя «крышка» — плоская, под днищем острова
      const k = Math.min(1, len / 0.95)
      p.setXYZ(i, dx * k * (w / 2), 0, dz * k * (d / 2))
      continue
    }
    const t = (v.y + 1) / (1 + TOP) // 0 — остриё снизу, 1 — верх
    const n = noise3(v.clone().multiplyScalar(1.4).add(sv))
    // уступы-пласты: радиус ступеньками по высоте — скала, а не гладкий конус
    const strata = 1 + 0.08 * Math.sign(Math.sin(t * 9 + seed)) * (1 - t)
    const r = Math.pow(t, 0.65) * (1 + 0.32 * n) * strata
    p.setXYZ(i, dx * r * (w / 2), -depth * (1 - t) + n * 0.5 * (1 - t), dz * r * (d / 2))
  }
  g.computeVertexNormals()
  return worldUV(g, TILE.cliff, [seed, 0, seed * 0.5])
}

/** Кочка травы: пучок тонких изогнутых травинок, цвет — в вершинах (тёмный низ, светлые кончики). */
export function grassClump() {
  const pos: number[] = []
  const col: number[] = []
  const base = new Color(0.03, 0.045, 0.015)
  const tips = [new Color(0.2, 0.24, 0.07), new Color(0.32, 0.27, 0.1)]
  for (let i = 0; i < 18; i++) {
    const a = hash3(i, 1, 2) * Math.PI * 2
    const r = hash3(i, 3, 4) * 0.16
    const h = 0.14 + hash3(i, 5, 6) * 0.18
    const w = 0.014 + hash3(i, 7, 8) * 0.01
    const lean = 0.06 + hash3(i, 9, 1) * 0.14
    const sa = a + 0.8 + hash3(i, 2, 3) * 1.4
    const bx = Math.cos(a) * r
    const bz = Math.sin(a) * r
    const sx = -Math.sin(sa) * w
    const sz = Math.cos(sa) * w
    const lx = Math.cos(a) * lean
    const lz = Math.sin(a) * lean
    const tip = tips[hash3(i, 4, 4) < 0.25 ? 1 : 0]
    const mid = base.clone().lerp(tip, 0.55)
    // нижний четырёхугольник (2 треугольника) + верхний треугольник
    const p0 = [bx - sx, -0.02, bz - sz]
    const p1 = [bx + sx, -0.02, bz + sz]
    const p2 = [bx + lx * 0.35 + sx * 0.7, h * 0.5, bz + lz * 0.35 + sz * 0.7]
    const p3 = [bx + lx * 0.35 - sx * 0.7, h * 0.5, bz + lz * 0.35 - sz * 0.7]
    const p4 = [bx + lx, h, bz + lz]
    for (const [pp, c] of [
      [p0, base], [p1, base], [p2, mid],
      [p0, base], [p2, mid], [p3, mid],
      [p3, mid], [p2, mid], [p4, tip],
    ] as [number[], Color][]) {
      pos.push(...pp)
      col.push(c.r * 2.4, c.g * 2.4, c.b * 2.4)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.computeVertexNormals()
  return g
}

/** Барабан колонны (центр в нуле), со «следами времени» на боках. */
export function columnDrum(r: number, h: number, seed: number) {
  const g = new CylinderGeometry(r * 0.97, r, h, 14, 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const n = (hash3(Math.round(x * 8) + seed, Math.round(y * 8), Math.round(z * 8)) - 0.5) * 0.03
    p.setXYZ(i, x * (1 + n), y, z * (1 + n))
  }
  g.computeVertexNormals()
  return worldUV(g, TILE.rock, [seed * 0.3, 0, seed * 0.7])
}

/**
 * Верх острова из каменных плит с щелями (как в лобби), склеенный в одну геометрию — одна отрисовка.
 * Плиты разного размера, верх каждой на 0…−3 см (по ним ходят — перепадов нет), толщина 0.3.
 */
export function slabTop(w: number, d: number, seed: number) {
  let r = seed * 9301 + 49297
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
  const parts: BufferGeometry[] = []
  const H = 0.3
  let z = -d / 2
  let k = 0
  while (z < d / 2 - 0.05) {
    let rh = Math.min(1.2 + rnd() * 1.1, d / 2 - z)
    if (d / 2 - z - rh < 0.6) rh = d / 2 - z
    let x = -w / 2
    while (x < w / 2 - 0.05) {
      let rw = Math.min(1.3 + rnd() * 1.2, w / 2 - x)
      if (w / 2 - x - rw < 0.6) rw = w / 2 - x
      const gap = 0.06 + rnd() * 0.05
      const dz = -rnd() * 0.03
      const g = new RoundedBoxGeometry(rw - gap, H, rh - gap, 1, 0.05)
      g.translate(x + rw / 2, dz - H / 2, z + rh / 2)
      worldUV(g, TILE.rock, [k * 0.37, 0, k * 0.61])
      parts.push(g.index ? g.toNonIndexed() : g)
      x += rw
      k++
    }
    z += rh
  }
  const merged = mergeGeometries(parts)!
  for (const g of parts) g.dispose()
  return merged
}
