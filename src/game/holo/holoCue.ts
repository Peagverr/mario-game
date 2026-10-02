/**
 * Что показывает голограмма — общий маленький объект между интерфейсом (обучение) и 3D-сценой.
 * Как runtime: меняется на месте, сцена читает его каждый кадр, React не перерисовывается.
 */
export type HoloCue = {
  /** Какой клип показывать; null — спрятать (тихо рассыпаться). */
  clip: string | null
  /** Номер показа: новый номер — голограмма появляется заново, даже если клип тот же. */
  cue: number
  /** Игрок повторил жест — рассыпаться со звоном и не появляться до следующего показа. */
  matched: boolean
}

export const holoCue: HoloCue = { clip: null, cue: 0, matched: false }

export function showHolo(clip: string) {
  holoCue.clip = clip
  holoCue.cue++
  holoCue.matched = false
}

export function matchHolo() {
  holoCue.matched = true
}

export function hideHolo() {
  holoCue.clip = null
}
