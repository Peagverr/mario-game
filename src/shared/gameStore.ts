import { create } from 'zustand'
import type { HintCode, Phase } from './controlState'

/** Статистика жестов за забег — для экрана итогов и «точности». */
export type GestureStats = {
  jumps: number
  /** Сколько раз замечена каждая ошибка (для разбора в конце). */
  errors: Partial<Record<HintCode, number>>
}

type GameState = {
  phase: Phase
  /** Номер забега: при «Сыграть ещё» сцена пересоздаётся с нуля. */
  runId: number
  starsCollected: number
  starsTotal: number
  startedAt: number
  finishedAt: number
  falls: number
  stats: GestureStats

  setPhase: (phase: Phase) => void
  setStarsTotal: (n: number) => void
  collectStar: () => void
  addFall: () => void
  countJump: () => void
  countError: (code: HintCode) => void
  startRun: () => void
  finishRun: () => void
  restart: () => void
}

const emptyStats = (): GestureStats => ({ jumps: 0, errors: {} })

export const useGame = create<GameState>((set) => ({
  phase: 'start',
  runId: 0,
  starsCollected: 0,
  starsTotal: 0,
  startedAt: 0,
  finishedAt: 0,
  falls: 0,
  stats: emptyStats(),

  setPhase: (phase) => set({ phase }),
  setStarsTotal: (starsTotal) => set({ starsTotal }),
  collectStar: () => set((s) => ({ starsCollected: s.starsCollected + 1 })),
  addFall: () => set((s) => ({ falls: s.falls + 1 })),
  countJump: () => set((s) => ({ stats: { ...s.stats, jumps: s.stats.jumps + 1 } })),
  countError: (code) =>
    set((s) => ({
      stats: { ...s.stats, errors: { ...s.stats.errors, [code]: (s.stats.errors[code] ?? 0) + 1 } },
    })),
  startRun: () => set({ phase: 'playing', startedAt: performance.now(), finishedAt: 0 }),
  finishRun: () => set({ phase: 'results', finishedAt: performance.now() }),
  restart: () =>
    set((s) => ({
      phase: 'countdown',
      runId: s.runId + 1,
      starsCollected: 0,
      falls: 0,
      startedAt: 0,
      finishedAt: 0,
      stats: emptyStats(),
    })),
}))

/** Время забега в секундах. */
export function runSeconds(s: Pick<GameState, 'startedAt' | 'finishedAt'>): number {
  if (!s.startedAt) return 0
  const end = s.finishedAt || performance.now()
  return (end - s.startedAt) / 1000
}

/** Очки: звёзды важнее всего, быстрее — лучше, падение — небольшой штраф. */
export function computeScore(stars: number, seconds: number, falls: number): number {
  const timeBonus = Math.max(0, Math.round((180 - seconds) * 5))
  return Math.max(0, stars * 100 + timeBonus - falls * 20)
}
