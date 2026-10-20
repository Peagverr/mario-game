/**
 * Таблица рекордов — отдельная для каждого уровня, хранится в браузере игрока (localStorage).
 * Имя придумываем сами: вводить его без клавиатуры неудобно.
 */
import { t } from '../i18n'

export type Record = { name: string; score: number; stars: number; seconds: number; at: number }

const key = (level: string) => `okno.leaderboard.v2.${level}`

/** Ник на языке игры: «Смелый Лис», «Brave Fox» (списки в src/i18n.ts, names). */
export function randomName() {
  const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
  const { adj, noun } = t().names
  return `${r(adj)} ${r(noun)}`
}

export function loadRecords(level: string): Record[] {
  try {
    return JSON.parse(localStorage.getItem(key(level)) ?? '[]') as Record[]
  } catch {
    return []
  }
}

/** Лучший результат уровня — для таблички у портала в лобби. */
export function bestRecord(level: string): Record | undefined {
  return loadRecords(level)[0]
}

/** Сохраняет результат и возвращает таблицу (лучшие 8) и место игрока (или −1). */
export function saveRecord(level: string, rec: Record): { top: Record[]; place: number } {
  const all = [...loadRecords(level), rec].sort((a, b) => b.score - a.score).slice(0, 8)
  try {
    localStorage.setItem(key(level), JSON.stringify(all))
  } catch {
    // Хранилище недоступно (приватное окно) — таблица просто не сохранится.
  }
  return { top: all, place: all.indexOf(rec) }
}
