import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { MathUtils, type Mesh, type Object3D } from 'three'
import { runtime } from '../runtime'

/**
 * Герой как на референсе: красный матовый малыш с рюкзаком (модель собрана в Blender, art/lobby.blend).
 * Ноги и ручки — отдельные куски: шагают и машут по скорости, в прыжке поджимаются.
 * Модель стоит ногами в y = 0; Player опускает её к низу капсулы.
 */
const URL = `${import.meta.env.BASE_URL}models/hero.glb`
/** Модель ростом 1.1 м; так герой примерно с капсулу физики (1.4 м) и не толще её заметно. */
const SCALE = 1.15

type Part = { o: Object3D; x: number; y: number; z: number }

export function HeroModel({ grounded }: { grounded: () => boolean }) {
  const { scene } = useGLTF(URL)
  const model = useMemo(() => scene.clone(true), [scene])
  const parts = useMemo(() => {
    const get = (n: string): Part => {
      const o = model.getObjectByName(n)!
      return { o, x: o.position.x, y: o.position.y, z: o.position.z }
    }
    model.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) m.castShadow = true
    })
    return { footL: get('FootL'), footR: get('FootR'), armL: get('ArmL'), armR: get('ArmR') }
  }, [model])

  const st = useMemo(() => ({ phase: 0, air: 0 }), [])
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const v = runtime.playerVel
    const speed = Math.hypot(v.x, v.z)
    const onGround = grounded()
    st.air = MathUtils.lerp(st.air, onGround ? 0 : 1, 1 - Math.exp(-12 * dt))
    const walk = onGround ? MathUtils.clamp(speed / 5, 0, 1) : 0
    st.phase += dt * (6 + speed * 1.6) * (walk > 0.05 ? 1 : 0)
    const s = Math.sin(st.phase)
    const { footL, footR, armL, armR } = parts
    // Шаг: ноги ходят вперёд-назад и чуть поднимаются; в воздухе поджаты.
    footL.o.position.set(footL.x, footL.y + Math.max(0, s) * 0.06 * walk + st.air * 0.05, footL.z + s * 0.09 * walk)
    footR.o.position.set(footR.x, footR.y + Math.max(0, -s) * 0.06 * walk + st.air * 0.05, footR.z - s * 0.09 * walk)
    // Ручки: машут в такт шагу, в прыжке разлетаются в стороны.
    armL.o.rotation.set(-s * 0.6 * walk, 0, -st.air * 0.9)
    armR.o.rotation.set(s * 0.6 * walk, 0, st.air * 0.9)
  })

  return <primitive object={model} scale={SCALE} />
}

useGLTF.preload(URL)
