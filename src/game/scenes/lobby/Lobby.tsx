import { Html, Outlines, RoundedBox, Sparkles } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3, type Mesh, type MeshBasicMaterial } from 'three'
import { useGame } from '../../../shared/gameStore'
import { bestRecord } from '../../../ui/leaderboard'
import { palette } from '../../palette'
import { Player } from '../../Player'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { toonGradient } from '../../toon'
import { LEVELS, type LevelInfo } from '../index'
import { LobbyHolo } from '../../holo/LobbyHolo'
import { Platforms } from '../level1/Platforms'
import type { Platform } from '../level1/levelData'

/**
 * Лобби: остров-хаб. Портал к каждому уровню из реестра LEVELS; зашёл в портал — начинается уровень.
 * Слотов под порталы три; если уровня ещё нет — портал серый с табличкой «скоро».
 */

const PLATFORMS: Platform[] = [
  { x: 0, z: 0, top: 0, w: 17, d: 12, h: 2.4, kind: 'island', checkpoint: true, trees: [[-7, 4], [7.2, 3.6], [-7.3, -1.5]] },
]
const SLOTS: [number, number, number][] = [
  [-5.2, 0, -3.6],
  [0, 0, -4.2],
  [5.2, 0, -3.6],
]
const SLOT_TITLES = ['Острова', 'Загляни', 'Поверни мир']

export function Lobby() {
  // В лобби камера шире, чтобы были видны все порталы с табличками.
  useEffect(() => {
    runtime.viewScale = 1.45
    return () => void (runtime.viewScale = 1)
  }, [])
  return (
    <>
      <Platforms platforms={PLATFORMS} />
      {SLOTS.map((pos, i) => (
        <Portal key={i} position={pos} level={LEVELS[i]} placeholder={SLOT_TITLES[i]} />
      ))}
      <Player spawn={[0, 1.2, 1]} killY={-10} />
      {/* Голограмма-подсказка обучения: показывает жест рядом с героем (что показать — решает Tutorial). */}
      <LobbyHolo />
    </>
  )
}

function Portal({ position, level, placeholder }: { position: [number, number, number]; level?: LevelInfo; placeholder: string }) {
  const disc = useRef<Mesh>(null)
  const color = level?.color ?? '#b9bfd3'
  const best = useMemo(() => (level ? bestRecord(level.id) : undefined), [level])
  const o = { thickness: 0.04, color: palette.ink }

  useFrame(({ clock }) => {
    const m = disc.current?.material as MeshBasicMaterial | undefined
    if (m) m.opacity = level ? 0.75 + Math.sin(clock.elapsedTime * 3) * 0.15 : 0.35
  })

  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      {/* Колонны — твёрдые, в портал входят только спереди. */}
      <CuboidCollider args={[0.28, 1.6, 0.28]} position={[-1.15, 1.6, 0]} />
      <CuboidCollider args={[0.28, 1.6, 0.28]} position={[1.15, 1.6, 0]} />
      {level && (
        <CuboidCollider
          sensor
          args={[0.85, 1.3, 0.35]}
          position={[0, 1.3, 0]}
          onIntersectionEnter={({ other }) => {
            if (other.rigidBodyObject?.name !== 'player') return
            const g = useGame.getState()
            // Обучение тоже идёт в лобби — зашёл в портал во время обучения, значит, готов играть.
            if (g.phase !== 'playing' && g.phase !== 'tutorial') return
            burst(new Vector3(position[0], 1.5, position[2]), color, 30, 6)
            sfx.confirm()
            g.goToScene(level.id)
          }}
        />
      )}
      {[-1.15, 1.15].map((x) => (
        <RoundedBox key={x} args={[0.56, 3.2, 0.56]} radius={0.12} position={[x, 1.6, 0]} castShadow>
          <meshToonMaterial color={palette.stone} gradientMap={toonGradient} />
          <Outlines {...o} />
        </RoundedBox>
      ))}
      <RoundedBox args={[3, 0.5, 0.6]} radius={0.12} position={[0, 3.35, 0]} castShadow>
        <meshToonMaterial color={level ? color : palette.stone} gradientMap={toonGradient} />
        <Outlines {...o} />
      </RoundedBox>
      <mesh ref={disc} position={[0, 1.55, 0]}>
        <planeGeometry args={[1.75, 2.9]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {level && <Sparkles count={18} scale={[1.8, 2.8, 0.6]} position={[0, 1.55, 0.1]} size={4} speed={0.6} color={color} />}
      <Html center position={[0, 3.4, 0.5]} distanceFactor={42} zIndexRange={[10, 0]}>
        <div className={`portal-sign ${level ? '' : 'is-locked'}`}>
          <b>{level?.title ?? placeholder}</b>
          <span>{level ? level.feature : 'скоро'}</span>
          {best && (
            <span className="portal-sign__best">
              рекорд {best.score} · ★{best.stars}
            </span>
          )}
        </div>
      </Html>
    </RigidBody>
  )
}
