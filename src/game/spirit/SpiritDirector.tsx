import { useEffect } from 'react'
import { lightCount, useGame } from '../../shared/gameStore'
import { Spirit } from './Spirit'
import { spiritAppear, spiritCelebrate, spiritFollow, spiritLight, spiritVanish } from './spiritState'

/**
 * Сюжет: мир застрял в ночи, дух потерял свет. Каждый пройденный уровень возвращает ему часть света:
 * в начале — обычный вид (не тусклее оригинала), после всех трёх — заметно ярче.
 */
const LIGHT_START = 1
const LIGHT_PER_LEVEL = 0.12
const LEVELS = 3
const lightFor = (completed: number) => LIGHT_START + LIGHT_PER_LEVEL * Math.min(LEVELS, completed)

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
    spiritLight(lightFor(lightCount(useGame.getState().completed)))
    return useGame.subscribe((s, prev) => {
      if (s.phase !== prev.phase) sync(s.phase)
      if (s.sceneId !== prev.sceneId || s.runId !== prev.runId) spiritFollow()
      if (s.starsCollected > prev.starsCollected) spiritCelebrate()
      if (s.phase === 'results' && prev.phase !== 'results') spiritCelebrate()
      if (s.completed.length !== prev.completed.length) spiritLight(lightFor(lightCount(s.completed)))
    })
  }, [])
  return <Spirit />
}
