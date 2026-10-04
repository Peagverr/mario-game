import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { useGame } from '../../../shared/gameStore'
import { bestRecord } from '../../../ui/leaderboard'
import { Player } from '../../Player'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { LEVELS, type LevelInfo } from '../index'
import { LobbyHolo } from '../../holo/LobbyHolo'
import { Platforms } from '../level1/Platforms'
import { LobbyWorld } from './LobbyWorld'
import type { Platform } from '../level1/levelData'

/**
 * Лобби: остров-хаб. Портал к каждому уровню из реестра LEVELS; зашёл в портал — начинается уровень.
 * Слотов под порталы три; если уровня ещё нет — портал серый с табличкой «скоро».
 * Вид острова, арок и фонарей — модель из Blender (LobbyWorld); здесь только коллайдеры и таблички.
 * Деревья в PLATFORMS остались ради коллайдеров: на их местах в модели стоят колонны.
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
      <Platforms platforms={PLATFORMS} visual={false} />
      <LobbyWorld />
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
  const color = level?.color ?? '#b9bfd3'
  const best = useMemo(() => (level ? bestRecord(level.id) : undefined), [level])
  // Сюжет: уровень пройден — его осколок света возвращён.
  const lit = useGame((s) => !!level && s.completed.includes(level.id))
  const sign = useRef<HTMLDivElement>(null)
  // Таблички читаются, только когда порталы видно спереди: повернул мир боком — они налезали бы друг на друга.
  useFrame(() => {
    const el = sign.current
    if (!el) return
    const a = Math.abs(runtime.cameraYaw)
    const k = a < 0.45 ? 1 : a > 0.8 ? 0 : 1 - (a - 0.45) / 0.35
    el.style.opacity = k.toFixed(2)
    el.style.visibility = k < 0.02 ? 'hidden' : 'visible'
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
      <Html center position={[0, 4.7, 0.3]} distanceFactor={42} zIndexRange={[10, 0]}>
        <div ref={sign} className={`portal-sign ${level ? '' : 'is-locked'} ${lit ? 'is-lit' : ''}`}>
          <b>{level?.title ?? placeholder}</b>
          <span>{level ? level.feature : 'скоро'}</span>
          {lit && <span className="portal-sign__lit">✦ свет возвращён</span>}
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
