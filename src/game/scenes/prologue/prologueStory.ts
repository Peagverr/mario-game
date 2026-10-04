/**
 * Пролог «Первый свет» — правила сюжета без отрисовки (тесты — prologueStory.test.ts, вид — Prologue.tsx).
 * Устройство уровня и откуда идеи — docs/story-research.md.
 */

/** Глубокая ночь в начале пролога. */
export const NIGHT_T = 0.08
/** Каждый зажжённый фонарь светлеет ночь на столько… */
export const PER_LANTERN_T = 0.035
/** …и увиденное воспоминание — ещё на столько. Рассвет — на итогах (RESULTS_TIME). */
export const MEMORY_T = 0.06

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Время суток в прологе: ночь светлеет с каждым фонарём и после воспоминания. */
export function prologueTime(lit: number, memorySeen: boolean) {
  return NIGHT_T + PER_LANTERN_T * Math.max(0, lit) + (memorySeen ? MEMORY_T : 0)
}

/** Сдвиг головы от её обычного места (м) меньше этого — не «заглянул». */
const PEEK_DEAD_M = 0.01
/** …а при таком — заглянул полностью. */
const PEEK_FULL_M = 0.05

/** Насколько игрок «заглянул» головой: 0 — сидит как обычно, 1 — явно сдвинул голову. */
export function peekAmount(headOffsetM: number) {
  return clamp01((Math.abs(headOffsetM) - PEEK_DEAD_M) / (PEEK_FULL_M - PEEK_DEAD_M))
}

/**
 * Насколько видно воспоминание. Рядом с ним — едва (чтобы было что заметить), а заглянул головой — целиком:
 * «Окно показывает то, чего не видят они» — механика окна и есть сюжет.
 */
export function memoryVisibility(nearby: number, peek: number) {
  return clamp01(nearby) * (0.3 + 0.7 * clamp01(peek))
}

/** Воспоминание считается увиденным, если оно было почти целиком видно столько секунд. */
export const MEMORY_SEEN_S = 0.4
export const MEMORY_SEEN_LEVEL = 0.7
