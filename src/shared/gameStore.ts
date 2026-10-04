import { create } from 'zustand'
import type { HintCode, Phase } from './controlState'

/** Какие сцены есть (полный реестр — в src/game/scenes/index.ts). */
export type SceneId = 'lobby' | 'level1' | 'level2' | 'level3'

/** Статистика жестов за забег — для экрана итогов и «точности». */
export type GestureStats = {
  jumps: number
  /** Сколько раз замечена каждая ошибка (для разбора в конце). */
  errors: Partial<Record<HintCode, number>>
}

/** Почему пауза: игрок открыл меню или камера перестала его видеть. */
export type PauseReason = 'menu' | 'camera'

type GameState = {
  phase: Phase
  pauseReason: PauseReason
  /** Когда началась пауза (0 — не на паузе): время на паузе в счёт забега не идёт. */
  pausedAt: number
  /** Текущая сцена: лобби или уровень. */
  sceneId: SceneId
  /** Номер забега: при «Сыграть ещё» сцена пересоздаётся с нуля. */
  runId: number
  starsCollected: number
  starsTotal: number
  /** Тайные звёзды (уровень «Загляни»): найдены взглядом / всего. */
  secretsFound: number
  secretsTotal: number
  startedAt: number
  finishedAt: number
  falls: number
  stats: GestureStats
  /** Какие уровни пройдены за эту сессию (до финиша) — сюжет: каждый возвращает духу свет. */
  completed: SceneId[]

  setPhase: (phase: Phase) => void
  /** Поставить игру на паузу (из игры). */
  pause: (reason: PauseReason) => void
  setStarsTotal: (n: number) => void
  collectStar: () => void
  setSecretsTotal: (n: number) => void
  findSecret: () => void
  addFall: () => void
  countJump: () => void
  countError: (code: HintCode) => void
  startRun: () => void
  finishRun: () => void
  restart: () => void
  /** Перейти в сцену: в уровень — через отсчёт, в лобби — сразу. */
  goToScene: (id: SceneId) => void
}

const emptyStats = (): GestureStats => ({ jumps: 0, errors: {} })

const freshRun = () => ({ starsCollected: 0, secretsFound: 0, falls: 0, startedAt: 0, finishedAt: 0, pausedAt: 0, stats: emptyStats() })

export const useGame = create<GameState>((set) => ({
  phase: 'start',
  pauseReason: 'menu',
  pausedAt: 0,
  sceneId: 'lobby',
  runId: 0,
  starsCollected: 0,
  starsTotal: 0,
  secretsFound: 0,
  secretsTotal: 0,
  startedAt: 0,
  finishedAt: 0,
  falls: 0,
  stats: emptyStats(),
  completed: [],

  setPhase: (phase) =>
    set((s) => {
      // Вышли из паузы обратно в игру — таймер забега сдвигается на время паузы.
      if (s.phase === 'paused' && phase === 'playing' && s.pausedAt && s.startedAt) {
        return { phase, pausedAt: 0, startedAt: s.startedAt + (performance.now() - s.pausedAt) }
      }
      if (phase === 'paused') return { phase, pausedAt: s.pausedAt || performance.now() }
      return { phase, pausedAt: 0 }
    }),
  pause: (pauseReason) => set((s) => ({ phase: 'paused', pauseReason, pausedAt: s.pausedAt || performance.now() })),
  setStarsTotal: (starsTotal) => set({ starsTotal }),
  collectStar: () => set((s) => ({ starsCollected: s.starsCollected + 1 })),
  setSecretsTotal: (secretsTotal) => set({ secretsTotal }),
  findSecret: () => set((s) => ({ secretsFound: s.secretsFound + 1 })),
  addFall: () => set((s) => ({ falls: s.falls + 1 })),
  countJump: () => set((s) => ({ stats: { ...s.stats, jumps: s.stats.jumps + 1 } })),
  countError: (code) =>
    set((s) => ({
      stats: { ...s.stats, errors: { ...s.stats.errors, [code]: (s.stats.errors[code] ?? 0) + 1 } },
    })),
  startRun: () => set({ phase: 'playing', startedAt: performance.now(), finishedAt: 0 }),
  finishRun: () =>
    set((s) => ({
      phase: 'results',
      finishedAt: performance.now(),
      completed: s.completed.includes(s.sceneId) ? s.completed : [...s.completed, s.sceneId],
    })),
  restart: () =>
    set((s) => ({
      phase: s.sceneId === 'lobby' ? 'playing' : 'countdown',
      runId: s.runId + 1,
      ...freshRun(),
    })),
  goToScene: (sceneId) =>
    set((s) => ({
      sceneId,
      phase: sceneId === 'lobby' ? 'playing' : 'countdown',
      runId: s.runId + 1,
      starsTotal: 0,
      secretsTotal: 0,
      ...freshRun(),
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
