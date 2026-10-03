import { useMemo } from 'react'
import { BoxGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { columnDrum, farKit, rockRoot, slabTop, TILE, worldUV } from './stoneKit'

/**
 * Средний план со всех сторон: кольцо парящих островков с руинами вокруг сцены (настоящая геометрия —
 * резкая и даёт параллакс при движении головы, в отличие от панорамы фона).
 * Все островки склеены в 3 геометрии по материалам — 3 отрисовки на всё кольцо.
 * Не закрывают героя ни при каком повороте мира: стоят дальше камеры (r ≥ minR) и ниже линии взгляда
 * (верх ≤ +1 м от героя, руины до 5 м — линия взгляда на таком расстоянии выше даже при наклоне 10°).
 */

type Props = { center?: [number, number, number]; count?: number; minR?: number; maxR?: number; seed?: number; lowCount?: number }

function merge(parts: BufferGeometry[]) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const out = mergeGeometries(flat)!
  for (const g of flat) g.dispose()
  return out
}

export function Surroundings({ center = [0, 0, 0], count = 16, minR = 60, maxR = 120, seed = 1, lowCount = 10 }: Props) {
  const fk = farKit()
  const geo = useMemo(() => {
    let r = seed * 7919 + 13
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
    const cliffs: BufferGeometry[] = []
    const stones: BufferGeometry[] = []
    const walls: BufferGeometry[] = []
    const moss: BufferGeometry[] = []
    // верхнее кольцо — вокруг, чуть ниже героя; нижний ярус — глубоко под сценой (видно, если смотреть вниз)
    for (let i = 0; i < count + lowCount; i++) {
      const low = i >= count
      const az = low ? rnd() * Math.PI * 2 : (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.3
      const dist = low ? 12 + rnd() * 55 : minR + rnd() * (maxR - minR)
      const x = Math.cos(az) * dist
      const z = Math.sin(az) * dist
      const y = low ? -24 - rnd() * 22 : -2 - rnd() * 14
      const w = (low ? 7 : 6) + rnd() * (low ? 10 : 7)
      const d = w * (0.65 + rnd() * 0.35)
      const H = 1.8 + rnd() * 1.2
      const capH = 0.55
      const rot = rnd() * Math.PI
      const place = (g: BufferGeometry) => g.rotateY(rot).translate(x, y, z)
      // тот же рецепт, что у островов уровней: плиты с мхом в щелях, кладка по бокам, скала снизу
      stones.push(place(slabTop(w, d, seed * 17 + i)))
      moss.push(place(worldUV(new BoxGeometry(w - 0.1, capH - 0.05, d - 0.1), TILE.moss, [i, 0, i]).translate(0, -0.08 - (capH - 0.05) / 2, 0)))
      walls.push(place(worldUV(new BoxGeometry(w - 0.3, H - capH, d - 0.3), TILE.wall, [i, 0, i]).translate(0, -capH - (H - capH) / 2, 0)))
      cliffs.push(place(rockRoot(w * 0.92, d * 0.92, Math.min(w, d) * 0.9 + 2, seed * 31 + i).translate(0, -H + 0.05, 0)))
      // руины: обломки колонн и куски стен
      const n = 1 + Math.floor(rnd() * 3)
      for (let k = 0; k < n; k++) {
        const px = (rnd() - 0.5) * w * 0.6
        const pz = (rnd() - 0.5) * d * 0.6
        if (rnd() < 0.55) {
          const h = 1.2 + rnd() * 2.5
          stones.push(place(columnDrum(0.34 + rnd() * 0.15, h, i * 5 + k).translate(px, h / 2, pz)))
        } else {
          const len = 2 + rnd() * 3
          const h = 1 + rnd() * 2
          walls.push(place(worldUV(new BoxGeometry(len, h, 0.6), TILE.wall, [i, k, 0]).rotateY(rnd() * 3).translate(px, h / 2, pz)))
        }
      }
    }
    return { cliff: merge(cliffs), stone: merge(stones), wall: merge(walls), moss: merge(moss) }
  }, [count, minR, maxR, seed, lowCount])

  return (
    <group position={center}>
      <mesh geometry={geo.cliff} material={fk.cliff} />
      <mesh geometry={geo.stone} material={fk.rock} />
      <mesh geometry={geo.wall} material={fk.wall} />
      <mesh geometry={geo.moss} material={fk.moss} />
    </group>
  )
}
