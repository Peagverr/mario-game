/**
 * Кульминация «Поверни мир»: на третьем острове, перед последним мостом, остров начинает рушиться.
 * Есть CLIMAX_S секунд, чтобы повернуть мир (мост соберётся) и перебежать на последний остров.
 *
 * Только правила, без отрисовки (их проверяют тесты climaxRules.test.ts); вид — в Climax.tsx.
 * - Отсчёт идёт, только пока идёт игра и герой на рушащемся острове или уже на мосту.
 *   Ушёл назад, на прошлый остров, — отсчёт стоит (не наказываем за осторожность).
 * - Время вышло, а герой ещё на острове — «не успел»: героя возвращает на остров, отсчёт заново.
 *   Если герой уже на мосту — не наказываем: пусть добежит.
 * - Добежал до последнего острова — «успел»: остров за спиной падает в пропасть.
 */

export const CLIMAX_S = 25

export type ClimaxState = {
  phase: 'idle' | 'running' | 'escaped'
  /** Сколько секунд осталось. */
  left: number
  /** Сколько секунд прошло с «успел» (для падения острова). */
  since: number
}

export type ClimaxInput = {
  playing: boolean
  onIsland: boolean
  onBridge: boolean
  onSafe: boolean
}

export type ClimaxEvent = 'start' | 'fail' | 'escape'

export const climaxStart = (): ClimaxState => ({ phase: 'idle', left: CLIMAX_S, since: 0 })

/** Насколько остров уже «разрушен», 0..1 — для тряски и обломков. */
export function climaxProgress(s: ClimaxState) {
  return s.phase === 'running' ? 1 - s.left / CLIMAX_S : s.phase === 'escaped' ? 1 : 0
}

/** Шаг правил на dt секунд. Меняет s на месте, возвращает событие этого шага (или null). */
export function climaxStep(s: ClimaxState, i: ClimaxInput, dt: number): ClimaxEvent | null {
  if (!i.playing) return null
  if (s.phase === 'idle') {
    if (!i.onIsland) return null
    s.phase = 'running'
    s.left = CLIMAX_S
    return 'start'
  }
  if (s.phase === 'escaped') {
    s.since += dt
    return null
  }
  if (i.onSafe) {
    s.phase = 'escaped'
    s.since = 0
    return 'escape'
  }
  if (!i.onIsland && !i.onBridge) return null
  s.left = Math.max(0, s.left - dt)
  if (s.left > 0 || !i.onIsland) return null
  s.left = CLIMAX_S
  return 'fail'
}
