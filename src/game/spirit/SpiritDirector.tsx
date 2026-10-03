import { useEffect } from 'react'
import { useGame } from '../../shared/gameStore'
import { Spirit } from './Spirit'
import { spiritAppear, spiritCelebrate, spiritFollow, spiritVanish } from './spiritState'

/**
 * Дух в игре: появляется у героя, как только игра идёт (обучение или уровень), и держится рядом.
 * Радуется звезде и финишу. Сложное поведение (показать жест, слетать к цели) вешает обучение через spiritState.
 */
export function SpiritDirector() {
  useEffect(() => {
    const sync = (phase: string) => {
      if (phase === 'playing' || phase === 'tutorial' || phase === 'results') spiritAppear()
      else if (phase === 'start') spiritVanish()
    }
    sync(useGame.getState().phase)
    return useGame.subscribe((s, prev) => {
      if (s.phase !== prev.phase) sync(s.phase)
      if (s.sceneId !== prev.sceneId || s.runId !== prev.runId) spiritFollow()
      if (s.starsCollected > prev.starsCollected) spiritCelebrate()
      if (s.phase === 'results' && prev.phase !== 'results') spiritCelebrate()
    })
  }, [])
  return <Spirit />
}
