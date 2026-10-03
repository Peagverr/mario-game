import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierCollider, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { runtime } from '../../runtime'
import { columnDrum, grassClump, rockRoot, slabTop, stoneBlock, stoneKit, TILE, worldUV } from '../../world/stoneKit'
import type { Platform } from './levelData'

/**
 * Вид платформ — тот же каменный мир, что лобби из Blender: плиты тёмного камня сверху, кладка по бокам,
 * скала-«корень» снизу тонет в дымке, по краю трава. Верх платформы ровно на top — края читаются.
 */

/** Номер платформы для «случайных», но одинаковых при каждом запуске форм. */
const seedOf = (p: Platform) => Math.abs(Math.round(p.x * 7.3 + p.z * 3.1 + p.top * 11))

const grassGeo = grassClump()
const grassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: 2 })
const dummy = new Object3D()

/** Трава по краю верха (и немного внутри) — одна отрисовка на остров. */
function GrassRing({ w, d, seed, inner = 8 }: { w: number; d: number; seed: number; inner?: number }) {
  const ref = useRef<InstancedMesh>(null)
  const count = Math.round((w + d) * 2 * 1.4) + inner
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    let r = seed * 9301 + 49297
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
    for (let i = 0; i < count; i++) {
      let x: number
      let z: number
      if (i < count - inner) {
        const t = rnd() * (w + d) * 2
        const inset = 0.25 + rnd() * 0.25
        if (t < w) [x, z] = [t - w / 2, d / 2 - inset]
        else if (t < w * 2) [x, z] = [t - w * 1.5, -d / 2 + inset]
        else if (t < w * 2 + d) [x, z] = [w / 2 - inset, t - w * 2 - d / 2]
        else [x, z] = [-w / 2 + inset, t - w * 2 - d * 1.5]
      } else {
        x = (rnd() - 0.5) * (w - 1)
        z = (rnd() - 0.5) * (d - 1)
      }
      const s = 0.7 + rnd() * 0.8
      dummy.position.set(x, 0, z)
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0)
      dummy.scale.set(s, s * (0.8 + rnd() * 0.5), s)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }, [w, d, seed, count, inner])
  return <instancedMesh ref={ref} args={[grassGeo, grassMat, count]} receiveShadow />
}

/** Остров: каменные плиты сверху, кладка по бокам, скала-«корень» снизу, трава по краю. */
function IslandMesh({ p }: { p: Platform }) {
  const kit = stoneKit()
  const seed = seedOf(p)
  const geo = useMemo(() => {
    const capH = 0.55
    return {
      capH,
      slabs: slabTop(p.w, p.d, seed),
      // под плитами — мох (виден в щелях)
      bed: worldUV(new BoxGeometry(p.w - 0.1, capH - 0.05, p.d - 0.1), TILE.moss, [seed, 0, seed]),
      body: worldUV(new BoxGeometry(p.w - 0.3, p.h - capH, p.d - 0.3), TILE.wall, [seed, 0, seed]),
      root: rockRoot(p.w * 0.9, p.d * 0.9, Math.min(p.w, p.d) * 0.9 + 1.5, seed),
    }
  }, [p.w, p.d, p.h, seed])
  return (
    <group>
      <mesh geometry={geo.slabs} material={kit.rock} castShadow receiveShadow />
      <mesh geometry={geo.bed} material={kit.moss} position={[0, -0.08 - (geo.capH - 0.05) / 2, 0]} receiveShadow />
      <mesh geometry={geo.body} material={kit.wall} position={[0, -geo.capH - (p.h - geo.capH) / 2, 0]} receiveShadow />
      <mesh geometry={geo.root} material={kit.cliff} position={[0, -p.h + 0.05, 0]} receiveShadow />
      <GrassRing w={p.w} d={p.d} seed={seed} />
      {p.trees?.map(([tx, tz], i) => <Column key={i} x={tx} z={tz} seed={seed + i} />)}
    </group>
  )
}

/** Склеить куски в одну геометрию (одна отрисовка вместо нескольких). */
function merge(parts: BufferGeometry[]) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const out = mergeGeometries(flat)!
  for (const g of flat) g.dispose()
  return out
}

/** Обломок колонны на месте дерева (коллайдер дерева остаётся — это препятствие). */
function Column({ x, z, seed }: { x: number; z: number; seed: number }) {
  const kit = stoneKit()
  const geo = useMemo(() => {
    const hs = [0.9, 0.85, 0.75].slice(0, 2 + (seed % 2))
    const base = stoneBlock(0.95, 0.22, 0.95, TILE.rock, seed, 0.04).translate(0, 0.11, 0)
    let y = 0.22
    const drums = hs.map((h, i) => {
      const rot = ((seed * 7 + i * 13) % 10) / 10
      const g = columnDrum(0.34, h, seed * 3 + i).rotateZ((rot - 0.5) * 0.06).rotateY(rot * 6).translate(0, y + h / 2, 0)
      y += h
      return g
    })
    return merge([base, ...drums])
  }, [seed])
  return <mesh geometry={geo} material={kit.rock} position={[x, 0, z]} castShadow receiveShadow />
}

/** Каменный блок-ступенька: камень со всех сторон и маленький «корень» снизу. */
function StoneMesh({ p }: { p: Platform }) {
  const kit = stoneKit()
  const seed = seedOf(p)
  const geo = useMemo(
    () => ({ block: stoneBlock(p.w, p.h, p.d, TILE.rock, seed, 0.1), root: rockRoot(p.w * 0.8, p.d * 0.8, 1.6, seed) }),
    [p.w, p.h, p.d, seed],
  )
  return (
    <group>
      <mesh geometry={geo.block} material={kit.rock} position={[0, -p.h / 2, 0]} castShadow receiveShadow />
      <mesh geometry={geo.root} material={kit.cliff} position={[0, -p.h + 0.05, 0]} />
    </group>
  )
}

/** Деревянный настил: доски поперёк длинной стороны с щелями, снизу две балки. */
function PlanksMesh({ p }: { p: Platform }) {
  const kit = stoneKit()
  const along = p.w >= p.d ? 'x' : 'z'
  const len = Math.max(p.w, p.d)
  const wid = Math.min(p.w, p.d)
  const geo = useMemo(() => {
    const n = Math.max(3, Math.round(len / 0.5))
    const step = len / n
    const plankH = Math.min(0.18, p.h * 0.5)
    const planks = Array.from({ length: n }, (_, i) =>
      worldUV(new BoxGeometry(step * 0.88, plankH, wid * (0.94 + ((i * 37) % 7) * 0.01)), TILE.planks, [i * 0.7, 0, i * 0.3])
        .rotateY((((i * 29) % 9) - 4) * 0.006)
        .translate(-len / 2 + step * (i + 0.5), -plankH / 2 + ((i * 53) % 5) * -0.006, 0),
    )
    const beams = [-1, 1].map((sd) =>
      worldUV(new BoxGeometry(len, p.h - plankH, 0.22), TILE.planks).translate(0, -plankH - (p.h - plankH) / 2, sd * (wid / 2 - 0.3)),
    )
    return merge([...planks, ...beams])
  }, [len, wid, p.h])
  return (
    <mesh geometry={geo} material={kit.planks} rotation={[0, along === 'x' ? 0 : Math.PI / 2, 0]} castShadow receiveShadow />
  )
}

function SlabMesh({ p }: { p: Platform }) {
  return p.kind === 'wood' ? <PlanksMesh p={p} /> : <StoneMesh p={p} />
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
