import { useMemo } from 'react'
import { BoxGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { columnDrum, farKit, rockRoot, slabTop, stoneKit, TILE, worldUV } from './stoneKit'

/**
 * Средний план со всех сторон: кольцо парящих островков с руинами вокруг сцены (настоящая геометрия —
 * резкая и даёт параллакс при движении головы, в отличие от панорамы фона).
 * Все островки склеены в 3 геометрии по материалам — 3 отрисовки на всё кольцо.
 * Не закрывают героя ни при каком повороте мира: стоят дальше камеры (r ≥ minR) и ниже линии взгляда
 * (верх ≤ +1 м от героя, руины до 5 м — линия взгляда на таком расстоянии выше даже при наклоне 10°).
 */

type Props = { center?: [number, number, number]; count?: number; minR?: number; maxR?: number; seed?: number }

function merge(parts: BufferGeometry[]) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const out = mergeGeometries(flat)!
  for (const g of flat) g.dispose()
  return out
}

export function Surroundings({ center = [0, 0, 0], count = 16, minR = 44, maxR = 90, seed = 1 }: Props) {
  const kit = stoneKit()
  const fk = farKit()
  const geo = useMemo(() => {
    let r = seed * 7919 + 13
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
    const cliffs: BufferGeometry[] = []
    const stones: BufferGeometry[] = []
    const walls: BufferGeometry[] = []
    for (let i = 0; i < count; i++) {
      const az = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.3
      const dist = minR + rnd() * (maxR - minR)
      const x = Math.cos(az) * dist
      const z = Math.sin(az) * dist
      const y = -2 - rnd() * 16
      const w = 5 + rnd() * 9
      const d = w * (0.6 + rnd() * 0.4)
      const rot = rnd() * Math.PI
      const place = (g: BufferGeometry) => g.rotateY(rot).translate(x, y, z)
      cliffs.push(place(rockRoot(w * 0.95, d * 0.95, w * 0.9 + 3, seed * 31 + i)))
      stones.push(place(slabTop(w, d, seed * 17 + i)))
      // руины на островке: обломки колонн и кусок стены
      const n = 1 + Math.floor(rnd() * 3)
      for (let k = 0; k < n; k++) {
        const px = (rnd() - 0.5) * w * 0.6
        const pz = (rnd() - 0.5) * d * 0.6
        if (rnd() < 0.55) {
          const h = 1.2 + rnd() * 3
          stones.push(place(columnDrum(0.35 + rnd() * 0.2, h, i * 5 + k).translate(px, h / 2, pz)))
        } else {
          const len = 2 + rnd() * 3
          const h = 1 + rnd() * 2.5
          walls.push(place(worldUV(new BoxGeometry(len, h, 0.6), TILE.wall, [i, k, 0]).rotateY(rnd() * 3).translate(px, h / 2, pz)))
        }
      }
    }
    return { cliff: merge(cliffs), stone: merge(stones), wall: merge(walls) }
  }, [count, minR, maxR, seed])

  return (
    <group position={center}>
      <mesh geometry={geo.cliff} material={kit.cliff} />
      <mesh geometry={geo.stone} material={fk.rock} />
      <mesh geometry={geo.wall} material={fk.wall} />
    </group>
  )
}
