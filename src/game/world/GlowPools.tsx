import { useMemo } from 'react'
import { AdditiveBlending, CanvasTexture, Color, MeshBasicMaterial, SpriteMaterial } from 'three'

/**
 * Дешёвый «свет» фонарей и порталов: светлое пятно на камне + ореол вокруг огонька.
 * Настоящий точечный свет считается для каждого пикселя всех материалов (8 штук в лобби — заметная нагрузка
 * для встроенной видеокарты рядом с распознаванием рук), а пятно — одна прозрачная плашка.
 */

let tex: CanvasTexture | null = null
function radial() {
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grd.addColorStop(0.6, 'rgba(255,255,255,0.15)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  tex = new CanvasTexture(c)
  return tex
}

type Pool = { at: [number, number, number]; color: string; radius?: number; strength?: number; halo?: number; haloAt?: [number, number, number] }

export function GlowPools({ pools }: { pools: Pool[] }) {
  const mats = useMemo(
    () =>
      pools.map((p) => ({
        floor: new MeshBasicMaterial({
          map: radial(),
          color: new Color(p.color).multiplyScalar(p.strength ?? 0.6),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          fog: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
        halo: new SpriteMaterial({
          map: radial(),
          color: new Color(p.color).multiplyScalar(0.9),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      })),
    [pools],
  )
  return (
    <>
      {pools.map((p, i) => (
        <group key={i}>
          <mesh position={[p.at[0], p.at[1] + 0.03, p.at[2]]} rotation={[-Math.PI / 2, 0, 0]} material={mats[i].floor} renderOrder={2}>
            <planeGeometry args={[(p.radius ?? 3) * 2, (p.radius ?? 3) * 2]} />
          </mesh>
          {p.halo ? <sprite position={p.haloAt ?? p.at} scale={p.halo} material={mats[i].halo} /> : null}
        </group>
      ))}
    </>
  )
}
