import { useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import type { Mesh, MeshStandardMaterial } from 'three'
import { hazy } from './haze'

/**
 * Башни-руины и дальние островки в дымке (из того же art/lobby.blend, что лобби) — фон для уровней.
 * position — центр уровня: башни стоят в 60–200 м вокруг него, в основном позади.
 * На уровнях камера ближе, чем в лобби, поэтому весь фон отодвинут ещё на PUSH вглубь.
 */
const PUSH = 30
/** Дымка по глубине (не сплошная заливка) + растворение у камеры: при повороте мира камера может подлететь к башне. */
const TOWER_HAZE = { far: 0.5, low: 0.65, nearFade: 34 }
const URL = `${import.meta.env.BASE_URL}models/towers.glb`

/** Окна башен — тёплые огни (светятся сквозь дымку, дают масштаб и жизнь, как на референсе). */
export function warmWindows(mt: MeshStandardMaterial) {
  mt.color.setRGB(0.05, 0.03, 0.02)
  mt.emissive.setRGB(1, 0.55, 0.22)
  mt.emissiveIntensity = 2.2
}

export function Towers({ position = [0, 0, 0], rotation = 0 }: { position?: [number, number, number]; rotation?: number }) {
  const { scene } = useGLTF(URL)
  const model = useMemo(() => {
    const m = scene.clone(true)
    m.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]
      // дымка слабее, чем у скал: башни — контрастные силуэты на фоне панорамы, а не бледные пятна
      for (const mt of mats) if (mt.name === 'TowerWindow') warmWindows(mt)
      mesh.material = Array.isArray(mesh.material) ? mats.map((x) => hazy(x, TOWER_HAZE)) : hazy(mats[0], TOWER_HAZE)
    })
    return m
  }, [scene])
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <primitive object={model} position={[0, -6, -PUSH]} />
    </group>
  )
}

useGLTF.preload(URL)
