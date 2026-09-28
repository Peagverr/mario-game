/**
 * Таблица рекордов — хранится в браузере игрока (localStorage).
 * Имя придумываем сами: вводить его без клавиатуры неудобно.
 */
export type Record = { name: string; score: number; stars: number; seconds: number; at: number }

const KEY = 'okno.leaderboard.v1'
const ADJ = ['Смелый', 'Быстрый', 'Ловкий', 'Хитрый', 'Весёлый', 'Зоркий', 'Прыгучий', 'Тихий']
const NOUN = ['Лис', 'Барс', 'Ёж', 'Филин', 'Кот', 'Сокол', 'Волк', 'Енот']

export function randomName() {
  const r = (a: string[]) => a[Math.floor(Math.random() * a.length)]
  return `${r(ADJ)} ${r(NOUN)}`
}

export function loadRecords(): Record[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Record[]
  } catch {
    return []
  }
}

/** Сохраняет результат и возвращает таблицу (лучшие 8) и место игрока (или −1). */
export function saveRecord(rec: Record): { top: Record[]; place: number } {
  const all = [...loadRecords(), rec].sort((a, b) => b.score - a.score).slice(0, 8)
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Хранилище недоступно (приватное окно) — таблица просто не сохранится.
  }
  return { top: all, place: all.indexOf(rec) }
}
