import { useEffect } from 'react'
import { useGame } from '../../../shared/gameStore'
import { LightShafts } from '../../LightShafts'
import { Player } from '../../Player'
import { Towers } from '../../world/Towers'
import { Surroundings } from '../../world/Surroundings'
import { Goal, Stars } from './Collectibles'
import { level1 } from './levelData'
import { Platforms } from './Platforms'

/** Лучи солнца на острова с чекпоинтами. */
const SHAFTS = [
  { at: [0, 0, 0] as [number, number, number], length: 24, width: 1.2, seed: 1 },
  { at: [14, 1.2, -3] as [number, number, number], length: 22, width: 1, seed: 2 },
  { at: [1, 3.6, -14] as [number, number, number], length: 22, width: 1.1, seed: 3 },
]

/**
 * Сцена «Уровень 1». Каждая мини-игра — такая же папка в scenes/ со своим компонентом.
 */
export function Level1() {
  useEffect(() => {
    useGame.getState().setStarsTotal(level1.stars.length)
  }, [])

  return (
    <>
      <Platforms platforms={level1.platforms} />
      <Stars positions={level1.stars} />
      <Goal position={level1.goal} />
      <Player spawn={level1.spawn} killY={level1.killY} />
      <Towers position={[2, 0, -8]} rotation={-0.4} />
      <LightShafts shafts={SHAFTS} />
      <Surroundings center={[2, 0, -8]} seed={5} />
    </>
  )
}
