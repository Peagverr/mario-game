/** Кривые движения голограммы: всё по кривым, ничего линейного. t — 0..1. */

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const easeInCubic = (t: number) => t * t * t
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const easeOutQuint = (t: number) => 1 - (1 - t) ** 5
/** Чуть перелетает и возвращается — «живой» доводчик (s — сила перелёта). */
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2

/** Прогресс отрезка [t0, t1] времени t с кривой ease: до — 0, после — 1. */
export function span(t: number, t0: number, t1: number, ease: (t: number) => number = easeInOutCubic) {
  return ease(clamp01((t - t0) / (t1 - t0)))
}
