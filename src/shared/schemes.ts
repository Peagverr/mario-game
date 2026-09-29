import { control, type MoveScheme } from './controlState'

/**
 * Три схемы ходьбы — чтобы сравнить вживую и выбрать лучшую.
 * Выбор запоминается в браузере.
 */
export type SchemeInfo = {
  id: MoveScheme
  title: string
  /** Легенда жестов в HUD. */
  legend: string[]
  /** Шаг обучения «иди». */
  moveTitle: string
  moveText: string
}

export const SCHEMES: SchemeInfo[] = [
  {
    id: 'palm',
    title: 'Ладонь',
    legend: ['ладонь — сдвинь, чтобы идти'],
    moveTitle: 'Сдвинь ладонь в сторону',
    moveText: 'Герой идёт туда, куда сдвинута ладонь от места, где она появилась. Хватит пары сантиметров.',
  },
  {
    id: 'pointer',
    title: 'Палец-наклон',
    legend: ['палец — куда показываешь', 'ладонь — стоп'],
    moveTitle: 'Покажи пальцем, куда идти',
    moveText: 'Выпрями указательный, остальные прижми. Палец вверх — вперёд, в сторону — вбок. Раскрыл ладонь — стоп.',
  },
  {
    id: 'fingertip',
    title: 'Палец-точка',
    legend: ['кончик пальца — джойстик', 'ладонь — стоп'],
    moveTitle: 'Вытяни палец и сдвинь кончик',
    moveText: 'Вытяни указательный — где кончик пальца, там центр. Сдвинь кончик в сторону — герой пойдёт. Раскрыл ладонь — стоп.',
  },
]

const KEY = 'okno.scheme.v1'

export function schemeInfo(id: MoveScheme = control.scheme) {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[1]
}

export function setScheme(id: MoveScheme) {
  control.scheme = id
  control.move.x = control.move.y = 0
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Хранилище недоступно — выбор просто не запомнится.
  }
  schemeListeners.forEach((fn) => fn(id))
}

export function nextScheme() {
  const i = SCHEMES.findIndex((s) => s.id === control.scheme)
  setScheme(SCHEMES[(i + 1) % SCHEMES.length].id)
}

/** Подписка на смену схемы — чтобы интерфейс перерисовался. */
const schemeListeners = new Set<(id: MoveScheme) => void>()
export function onSchemeChange(fn: (id: MoveScheme) => void) {
  schemeListeners.add(fn)
  return () => void schemeListeners.delete(fn)
}

// Восстановить выбор при запуске.
try {
  const saved = localStorage.getItem(KEY) as MoveScheme | null
  if (saved && SCHEMES.some((s) => s.id === saved)) control.scheme = saved
} catch {
  // ignore
}
