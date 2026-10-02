import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Vector3 } from 'three'
import { runtime } from '../runtime'
import { HoloHand } from './HoloHand'
import { holoCue } from './holoCue'

/**
 * Голограмма-подсказка в лобби (обучение): стоит рядом с героем — сбоку и чуть ближе к камере,
 * чтобы никогда его не закрывать. Справа от героя, а если там край острова — слева.
 */

/** Сдвиг от героя: вбок по экрану и к камере (единицы мира), высота центра ладони над землёй. */
const SIDE = 2.6
const TOWARD_CAMERA = 0.9
const HEIGHT = 1.95
/** Остров лобби (половины ширины и глубины) с запасом под проектор. */
const ISLAND = { x: 7.6, z: 5.2 }

export function LobbyHolo() {
  const target = useMemo(() => new Vector3(), [])
  const st = useMemo(() => ({ side: 1 }), [])

  useFrame(() => {
    const yaw = runtime.cameraYaw
    const rx = Math.cos(yaw)
    const rz = -Math.sin(yaw)
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    const p = runtime.playerPos
    const at = (side: number, axis: 'x' | 'z') => (axis === 'x' ? p.x + rx * SIDE * side + fx * TOWARD_CAMERA : p.z + rz * SIDE * side + fz * TOWARD_CAMERA)
    const fits = (side: number) => Math.abs(at(side, 'x')) < ISLAND.x && Math.abs(at(side, 'z')) < ISLAND.z
    // Сторону меняем, только если на текущей рука повисла бы над пропастью: без дёрганья туда-сюда.
    if (!fits(st.side) && fits(-st.side)) st.side = -st.side
    target.set(at(st.side, 'x'), HEIGHT, at(st.side, 'z'))
  })

  return <HoloHand cue={holoCue} target={target} groundY={0} />
}
