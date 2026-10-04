/**
 * Ступени качества картинки: если кадров мало, PerformanceMonitor спускает на ступень, хватает — поднимает обратно.
 *
 * Порядок жертв — от незаметного к заметному: сначала сглаживание (MSAA) и тяжёлые эффекты (runtime.lowQuality),
 * и только в последнюю очередь чёткость — не ниже 80% обычной и не ниже пикселя экрана.
 * Раньше чёткость падала до 0.85 (на экране 2× — 42% по каждой стороне, «мыло») и обратно не возвращалась,
 * а кадров это почти не давало: их съедает распознавание на главном потоке, а не видеокарта.
 */

export type Quality = {
  /** Пикселей рендера на пиксель CSS. */
  dpr: number
  /** Сглаживание в постобработке: 4 — MSAA ×4, 0 — выключено. */
  msaa: number
  /** Слабый режим эффектов (меньше искр, тумана) — runtime.lowQuality. */
  low: boolean
}

/** Выше 1.5 не рисуем: на экране 2× разница почти не видна, а пикселей почти вдвое больше. */
const MAX_DPR = 1.5
/** Самый слабый режим — не мыльнее этой доли обычной чёткости. */
const MIN_SHARPNESS = 0.8
/** Ниже стольких кадров в секунду (устойчиво) — на ступень вниз; от стольких — на ступень вверх. */
const FPS_DOWN = 30
const FPS_UP = 50
/** Столько раз переключились туда-обратно — режим больше не меняем, чтобы картинка не мигала. */
export const QUALITY_FLIPFLOPS = 4

export function qualityLevels(deviceDpr: number): Quality[] {
  const high = Math.min(deviceDpr > 0 ? deviceDpr : 1, MAX_DPR)
  const floor = Math.min(high, Math.max(1, high * MIN_SHARPNESS))
  const levels: Quality[] = [
    { dpr: high, msaa: 4, low: false },
    { dpr: high, msaa: 0, low: true },
    { dpr: floor, msaa: 0, low: true },
  ]
  // На обычном экране чёткость не снижается — последняя ступень совпала бы с предыдущей.
  return levels.filter((q, i) => i === 0 || q.dpr !== levels[i - 1].dpr || q.msaa !== levels[i - 1].msaa || q.low !== levels[i - 1].low)
}

export function stepQuality(level: number, dir: 'up' | 'down', count: number) {
  return Math.min(count - 1, Math.max(0, level + (dir === 'down' ? 1 : -1)))
}

/**
 * Пороги для PerformanceMonitor. Обычные пороги drei зависят от частоты экрана: на 120–144 Гц качество резалось
 * уже ниже 60 к/с, а возвращалось только от 100 — с камерой и нейросетями такого не бывает.
 */
export function qualityBounds(_refreshRate: number): [number, number] {
  return [FPS_DOWN, FPS_UP]
}
