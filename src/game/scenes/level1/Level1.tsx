import { useEffect } from 'react'
import { useGame } from '../../../shared/gameStore'
import { Player } from '../../Player'
import { Goal, Stars } from './Collectibles'
import { level1 } from './levelData'
import { Platforms } from './Platforms'

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
    </>
  )
}
