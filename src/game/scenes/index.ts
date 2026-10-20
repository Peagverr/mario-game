import type { ComponentType } from 'react'
import { Level1 } from './level1/Level1'
import { Level2 } from './level2/Level2'
import { Level3 } from './level3/Level3'
import { Lobby } from './lobby/Lobby'

/**
 * Реестр сцен. Новая мини-игра = новая папка в scenes/ + строка здесь.
 * Лобби само покажет портал к каждому уровню из списка LEVELS.
 */

import type { SceneId } from '../../shared/gameStore'

export type { SceneId }

export type LevelInfo = {
  /** Название уровня и чему он учит (табличка портала) — в src/i18n.ts, levels[id]. */
  id: Exclude<SceneId, 'lobby'>
  color: string
  component: ComponentType
}

export const LEVELS: LevelInfo[] = [
  { id: 'level1', color: '#ffd23f', component: Level1 },
  { id: 'level2', color: '#2ec4b6', component: Level2 },
  { id: 'level3', color: '#ff5a5f', component: Level3 },
]

export const SCENES: Record<SceneId, ComponentType | undefined> = {
  lobby: Lobby,
  level1: Level1,
  level2: Level2,
  level3: Level3,
}

export function levelInfo(id: SceneId) {
  return LEVELS.find((l) => l.id === id)
}

/** Следующий уровень после этого (или undefined, если это последний). */
export function nextLevel(id: SceneId) {
  const i = LEVELS.findIndex((l) => l.id === id)
  return i >= 0 ? LEVELS[i + 1] : undefined
}
