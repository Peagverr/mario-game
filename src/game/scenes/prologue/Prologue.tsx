import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, MeshBasicMaterial, Vector3, type Group, type Mesh } from 'three'
import { control } from '../../../shared/controlState'
import { useGame } from '../../../shared/gameStore'
import { storyTime } from '../../atmosphere/atmosphere'
import { LightShafts } from '../../LightShafts'
import { palette } from '../../palette'
import { Player } from '../../Player'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { spiritCelebrate, spiritFollow, spiritGuide } from '../../spirit/spiritState'
import { PRIORITY, say } from '../../voice'
import { stoneKit } from '../../world/stoneKit'
import { Surroundings } from '../../world/Surroundings'
import { Towers } from '../../world/Towers'
import { Stars } from '../level1/Collectibles'
import { Platforms } from '../level1/Platforms'
import type { Platform } from '../level1/levelData'
import { GhostBridge, type Bridge } from '../level3/Level3'
import { MEMORY_SEEN_LEVEL, MEMORY_SEEN_S, memoryVisibility, peekAmount, prologueTime } from './prologueStory'

/**
 * Пролог «Первый свет» — уровень с полным сюжетом (для теста). Почему он устроен так — docs/story-research.md.
 *
 * Введение: ночь, вдали столб света (осколок) — цель видна с первого кадра (как гора в Journey).
 * Развитие: огоньки на тропе; каждый собранный зажигает фонарь, и ночь светлеет. Брошенная стоянка
 *   рассказывает «что здесь случилось» без слов.
 * Поворот: воспоминание — призраки малыша и духа у фонаря; целиком видно, только если заглянуть головой
 *   (механика окна = сюжет). Дальше мост рассыпан — собрать поворотом мира.
 * Развязка: осколок света — вспышка, рассвет на итогах, «Один осколок вернулся».
 */

const PLATFORMS: Platform[] = [
  { x: 0, z: 0, top: 0, w: 7, d: 7, h: 2.4, kind: 'island', checkpoint: true, trees: [[-2.4, 2.2]] },
  { x: 5.5, z: -1.5, top: 0.3, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
  { x: 8.5, z: -3, top: 0.6, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
  { x: 13, z: -3, top: 0.6, w: 6, d: 6, h: 2.4, kind: 'island', checkpoint: true },
  { x: 13, z: -9, top: 0.6, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
  { x: 13, z: -14, top: 0.6, w: 7, d: 6, h: 2.4, kind: 'island', checkpoint: true },
  { x: 0, z: -14, top: 0.6, w: 6, d: 6, h: 2.4, kind: 'island', checkpoint: true },
]
/** Последний мост рассыпан — собирается поворотом мира (как в «Поверни мир»). */
const BRIDGE: Bridge = { from: [9.5, -14], to: [3, -14], top: 0.6, width: 2.4, targetYaw: 0.9 }
/** Огоньки (это звёзды уровня) — по одному на фонарь, по ходу тропы. */
const MOTES: [number, number, number][] = [
  [1.5, 1.1, -1.5],
  [5.5, 1.4, -1.5],
  [8.5, 1.7, -3],
  [12, 1.7, -2.4],
  [14.8, 1.7, -5.2],
  [13, 1.7, -9],
  [11.5, 1.7, -12.4],
]
/** Фонари вдоль тропы: зажигаются по порядку, по одному на каждый собранный огонёк. */
const LANTERNS: [number, number, number][] = [
  [2.7, 0, -2.7],
  [6.4, 0.3, -0.7],
  [9.3, 0.6, -2.2],
  [10.6, 0.6, -1],
  [15.6, 0.6, -5.4],
  [13.9, 0.6, -8.2],
  [10.2, 0.6, -11.6],
]
const SHARD: [number, number, number] = [-0.6, 0.6, -14.6]
const MEMORY: [number, number, number] = [15, 0.6, -15.4]
/** За сколько секунд «обычное» место головы догоняет текущее. */
const HEAD_NEUTRAL_S = 6
/** Рядом с воспоминанием — в пределах этого (м). */
const MEMORY_NEAR_M = 3.6
const SHAFTS = [{ at: [SHARD[0], SHARD[1], SHARD[2]] as [number, number, number], length: 26, width: 1.2, seed: 4 }]

const VIEW_SCALE = 1.2

const WARM = new Color('#ffb84d')
const COLD = new Color('#2a3244')

export function Prologue() {
  useEffect(() => {
    useGame.getState().setStarsTotal(MOTES.length)
    storyTime.t = prologueTime(0, false)
    // Обзор чуть шире обычного уровня: больше мира и столб света ближе к кадру.
    runtime.viewScale = VIEW_SCALE
    return () => {
      storyTime.t = null
      runtime.viewScale = 1
    }
  }, [])
  return (
    <>
      <Platforms platforms={PLATFORMS} />
      <Stars positions={MOTES} />
      {LANTERNS.map((p, i) => (
        <Lantern key={i} position={p} index={i} />
      ))}
      <Camp />
      <Memory />
      <GhostBridge b={BRIDGE} />
      <Shard />
      <GoalBeacon />
      <StoryDriver />
      <Player spawn={[0, 1.2, 1.2]} killY={-10} />
      <Towers position={[6, 0, -7]} rotation={0.3} />
      <LightShafts shafts={SHAFTS} />
      <Surroundings center={[6.5, 0, -7]} seed={5} />
    </>
  )
}

/** Сюжет по ходу уровня: время суток, реплики Окна, дух показывает дорогу. */
function StoryDriver() {
  const st = useRef({ lit: 0, memoryNear: false, memorySeen: false, bridge: false, intro: false })
  useFrame(() => {
    const g = useGame.getState()
    if (g.phase !== 'playing') return
    const s = st.current
    const pos = runtime.playerPos

    // Введение: дух на миг летит к столбу света — «вот куда идём».
    if (!s.intro) {
      s.intro = true
      spiritGuide({ x: SHARD[0], y: SHARD[1] + 3, z: SHARD[2] }, 1.2)
    }

    // Развитие: огоньки зажигают фонари.
    const lit = Math.min(LANTERNS.length, g.starsCollected)
    if (lit > s.lit) {
      if (s.lit === 0) say('story.p.lantern', { priority: PRIORITY.story, waitMs: 6000 })
      s.lit = lit
    }

    // Поворот: воспоминание. Подошёл — Окно подсказывает заглянуть, дух летит к нему.
    const nearMemory = Math.hypot(pos.x - MEMORY[0], pos.z - MEMORY[2]) < MEMORY_NEAR_M
    if (nearMemory && !s.memoryNear) {
      s.memoryNear = true
      say('story.p.memory', { priority: PRIORITY.story, waitMs: 6000 })
      spiritGuide({ x: MEMORY[0] - 0.6, y: MEMORY[1] + 1.6, z: MEMORY[2] + 0.4 }, 4)
    }
    if (memory.seen && !s.memorySeen) {
      s.memorySeen = true
      say('story.p.together', { priority: PRIORITY.story, waitMs: 6000 })
      spiritCelebrate()
      spiritFollow()
    }

    // …и мост рассыпан. Дух перелетает пропасть к осколку и возвращается.
    const atBridge = pos.z < -11.5 && pos.z > -16.5 && pos.x < 11.2 && pos.x > 8.5
    if (atBridge && !s.bridge) {
      s.bridge = true
      say('story.p.bridge', { priority: PRIORITY.story, waitMs: 6000 })
      spiritGuide({ x: (BRIDGE.from[0] + BRIDGE.to[0]) / 2, y: BRIDGE.top + 2, z: BRIDGE.from[1] }, 2.5)
    }

    storyTime.t = prologueTime(s.lit, s.memorySeen)
  })
  return null
}

/** Фонарь на тропе: погасший — холодный камень; огонёк собран — загорается тёплым (свечение даёт bloom). */
function Lantern({ position, index }: { position: [number, number, number]; index: number }) {
  const flame = useRef<Mesh>(null)
  const lit = useRef(0)
  const was = useRef(false)
  const mat = useMemo(() => new MeshBasicMaterial({ color: COLD.clone(), toneMapped: false }), [])
  const kit = stoneKit()
  useFrame(({ clock }, dt) => {
    const on = useGame.getState().starsCollected > index
    if (on && !was.current) {
      burst(new Vector3(position[0], position[1] + 1.9, position[2]), palette.star, 14, 3)
      sfx.tick()
    }
    was.current = on
    lit.current += ((on ? 1 : 0) - lit.current) * (1 - Math.exp(-4 * dt))
    const flicker = 1 + Math.sin(clock.elapsedTime * 9 + index) * 0.06 * lit.current
    mat.color.copy(COLD).lerp(WARM, lit.current).multiplyScalar(1 + 3 * lit.current * flicker)
    if (flame.current) flame.current.scale.setScalar(0.7 + 0.3 * lit.current)
  })
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} material={kit.planks} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 1.8, 8]} />
      </mesh>
      <mesh position={[0, 1.9, 0]} material={kit.rock} castShadow>
        <boxGeometry args={[0.38, 0.06, 0.38]} />
      </mesh>
      <mesh ref={flame} position={[0, 2.08, 0]} material={mat}>
        <sphereGeometry args={[0.14, 12, 10]} />
      </mesh>
      <mesh position={[0, 2.32, 0]} material={kit.rock} castShadow>
        <coneGeometry args={[0.26, 0.2, 4]} />
      </mesh>
    </group>
  )
}

/**
 * Брошенная стоянка на втором острове — «что здесь случилось» без слов: упавший фонарь, рассыпанные доски,
 * холодное кострище из камней. Здесь кто-то шёл к свету и не дошёл.
 */
function Camp() {
  const kit = stoneKit()
  const y = 0.6
  const stones = useMemo(() => Array.from({ length: 7 }, (_, i) => (i / 7) * Math.PI * 2), [])
  return (
    <group position={[14, y, -1.4]}>
      {/* кострище */}
      {stones.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55]} rotation={[a, a * 2, 0]} material={kit.rock} castShadow>
          <dodecahedronGeometry args={[0.13 + (i % 3) * 0.03, 0]} />
        </mesh>
      ))}
      <mesh position={[0, 0.05, 0]} rotation={[0, 0.6, Math.PI / 2]} material={kit.planks}>
        <cylinderGeometry args={[0.05, 0.05, 0.7, 6]} />
      </mesh>
      {/* упавший фонарь */}
      <group position={[1.3, 0.08, 0.6]} rotation={[0, 0.9, Math.PI / 2 - 0.1]}>
        <mesh position={[0, 0.9, 0]} material={kit.planks} castShadow>
          <cylinderGeometry args={[0.06, 0.08, 1.8, 8]} />
        </mesh>
        <mesh position={[0, 1.9, 0]} material={kit.rock}>
          <boxGeometry args={[0.38, 0.06, 0.38]} />
        </mesh>
      </group>
      {/* рассыпанные доски */}
      {[
        [-1.2, 0.05, 0.8, 0.3],
        [-1.5, 0.05, -0.3, 1.2],
        [-0.6, 0.12, 1.3, 2.1],
      ].map(([x, yy, z, r], i) => (
        <mesh key={i} position={[x, yy, z]} rotation={[0, r, i === 2 ? 0.25 : 0]} material={kit.planks} castShadow receiveShadow>
          <boxGeometry args={[1.2, 0.08, 0.28]} />
        </mesh>
      ))}
    </group>
  )
}

/** Общее состояние воспоминания (его читает StoryDriver). */
const memory = { seen: false }

/**
 * Воспоминание (как в Unravel): призраки малыша и духа у фонаря — так здесь было, когда мир светился.
 * Рядом — едва видно; заглянул головой (окно) — видно целиком. Увидел — история двигается дальше.
 */
function Memory() {
  const group = useRef<Group>(null)
  const headAvg = useRef<number | null>(null)
  const seenFor = useRef(0)
  const mat = useMemo(
    () => new MeshBasicMaterial({ color: new Color('#9fd8ff').multiplyScalar(1.6), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )
  useEffect(() => {
    memory.seen = false
  }, [])
  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const pos = runtime.playerPos
    const d = Math.hypot(pos.x - MEMORY[0], pos.z - MEMORY[2])
    const nearby = Math.max(0, Math.min(1, (MEMORY_NEAR_M + 1 - d) / 2))
    // «Заглянул»: голова сдвинута от своего обычного места (оно медленно подстраивается, как в WindowCamera).
    const h = control.head
    if (headAvg.current === null) headAvg.current = h.x
    // Подстраивается медленно (6 с): заглянул и держишь — «заглядывание» не тает, пока смотришь.
    headAvg.current += (h.x - headAvg.current) * (1 - Math.exp(-dt / HEAD_NEUTRAL_S))
    const peek = h.visible ? peekAmount(h.x - headAvg.current) : 0
    const target = memory.seen ? Math.max(0.55 * nearby, 0.25) : memoryVisibility(nearby, peek)
    mat.opacity += (target - mat.opacity) * (1 - Math.exp(-5 * dt))
    if (!memory.seen) {
      seenFor.current = mat.opacity > MEMORY_SEEN_LEVEL ? seenFor.current + dt : 0
      if (seenFor.current > MEMORY_SEEN_S) {
        memory.seen = true
        burst(new Vector3(MEMORY[0], MEMORY[1] + 1.2, MEMORY[2]), '#9fd8ff', 24, 3)
      }
    }
    const g = group.current
    if (g) {
      g.visible = mat.opacity > 0.01
      g.position.y = MEMORY[1] + Math.sin(clock.elapsedTime * 1.2) * 0.05
    }
  })
  return (
    <group ref={group} position={MEMORY}>
      {/* малыш */}
      <mesh position={[0, 0.55, 0]} material={mat}>
        <capsuleGeometry args={[0.28, 0.45, 6, 12]} />
      </mesh>
      <mesh position={[0, 1.2, 0]} material={mat}>
        <sphereGeometry args={[0.3, 16, 12]} />
      </mesh>
      {/* фонарь в руке */}
      <mesh position={[0.45, 0.75, 0.1]} material={mat}>
        <sphereGeometry args={[0.12, 10, 8]} />
      </mesh>
      {/* дух рядом */}
      <group position={[-0.7, 1.35, 0.15]}>
        <mesh material={mat}>
          <sphereGeometry args={[0.24, 14, 10]} />
        </mesh>
        <mesh position={[0.05, -0.34, 0]} rotation={[0, 0, 0.3]} material={mat}>
          <coneGeometry args={[0.16, 0.5, 10]} />
        </mesh>
      </group>
    </group>
  )
}

/** Осколок света — цель, видная с первого кадра: кристалл и высокий столб. Дошёл — история главы закончена. */
function Shard() {
  const crystal = useRef<Mesh>(null)
  const mats = useMemo(
    () => ({
      crystal: new MeshBasicMaterial({ color: new Color('#ffd76a').multiplyScalar(3), toneMapped: false }),
      beam: new MeshBasicMaterial({ color: new Color('#ffcf6b'), transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }),
    }),
    [],
  )
  useFrame(({ clock }) => {
    const c = crystal.current
    if (!c) return
    c.rotation.y = clock.elapsedTime * 0.8
    c.position.y = 1.6 + Math.sin(clock.elapsedTime * 1.6) * 0.12
  })
  return (
    <RigidBody type="fixed" colliders={false} position={SHARD}>
      <CuboidCollider
        sensor
        args={[0.9, 1.5, 0.9]}
        position={[0, 1.5, 0]}
        onIntersectionEnter={({ other }) => {
          if (other.rigidBodyObject?.name !== 'player') return
          const g = useGame.getState()
          if (g.phase !== 'playing') return
          burst(new Vector3(SHARD[0], SHARD[1] + 1.6, SHARD[2]), palette.star, 60, 8)
          spiritCelebrate()
          sfx.finish()
          g.finishRun()
        }}
      />
      <mesh ref={crystal} position={[0, 1.6, 0]} material={mats.crystal}>
        <octahedronGeometry args={[0.45, 0]} />
      </mesh>
      <mesh position={[0, 9, 0]} material={mats.beam}>
        <cylinderGeometry args={[0.7, 0.9, 18, 24, 1, true]} />
      </mesh>
    </RigidBody>
  )
}

/**
 * Цель видна всегда (как гора в Journey): камера смотрит сверху, и осколок часто за краем кадра —
 * тогда у края экрана светится огонёк в его сторону. Без слов и стрелок-подписей.
 */
function GoalBeacon() {
  const camera = useThree((st) => st.camera)
  const gl = useThree((st) => st.gl)
  const el = useMemo(() => {
    const d = document.createElement('div')
    d.className = 'goal-beacon'
    return d
  }, [])
  useEffect(() => {
    const parent = gl.domElement.parentElement ?? document.body
    parent.appendChild(el)
    return () => el.remove()
  }, [gl, el])
  const v = useMemo(() => new Vector3(), [])
  useFrame(() => {
    v.set(SHARD[0], SHARD[1] + 1.6, SHARD[2]).project(camera)
    const playing = useGame.getState().phase === 'playing'
    // Позади камеры проекция переворачивается — разворачиваем.
    let x = v.x
    let y = v.y
    if (v.z > 1) {
      x = -x
      y = -y
    }
    const inside = Math.abs(x) < 0.92 && Math.abs(y) < 0.88 && v.z <= 1
    el.style.display = playing && !inside ? '' : 'none'
    if (inside || !playing) return
    // Прижимаем к краю экрана по направлению на осколок.
    const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 1e-6)
    const ex = Math.max(-0.92, Math.min(0.92, x * k))
    const ey = Math.max(-0.86, Math.min(0.86, y * k))
    el.style.left = `${((ex + 1) / 2) * 100}%`
    el.style.top = `${((1 - ey) / 2) * 100}%`
  })
  return null
}
