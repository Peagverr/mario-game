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
const TOWER_HAZE = { far: 0.7, low: 0.75 }
const URL = `${import.meta.env.BASE_URL}models/towers.glb`

export function Towers({ position = [0, 0, 0], rotation = 0 }: { position?: [number, number, number]; rotation?: number }) {
  const { scene } = useGLTF(URL)
  const model = useMemo(() => {
    const m = scene.clone(true)
    m.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]
      // дымка слабее, чем у скал: башни — контрастные силуэты на фоне панорамы, а не бледные пятна
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
