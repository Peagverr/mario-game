import { afterEach, describe, expect, it } from 'vitest'
import LINES from './game/voiceLines.json'
import { t, useLang, type Dict } from './i18n'

/** Все строки словаря; функции вызываем с пробными значениями. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (typeof v === 'function') {
    const f = v as (...a: unknown[]) => unknown
    // Подстановки бывают числами, строками или списком пальцев — пробуем все, что подходит.
    return [[3, 5], ['X'], [['ring', 'pinky']]].flatMap((a) => {
      try {
        return strings(f(...a))
      } catch {
        return []
      }
    })
  }
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}

function englishDict(): Dict {
  useLang.getState().setLang('en')
  return t()
}

/** В английском тексте не должно остаться русского и типографских знаков, которые у нас под запретом. */
const BAD = /[А-Яа-яЁё—–→“”‘’…]/

afterEach(() => useLang.getState().setLang('en'))

describe('английская версия', () => {
  it('по умолчанию игра на английском', () => {
    expect(useLang.getState().lang).toBe('en')
  })

  it('в английском словаре нет русских букв, длинных тире, стрелок и кривых кавычек', () => {
    const d = englishDict()
    // Кнопка «Русский» в меню намеренно по-русски: по ней переключаются на русский.
    const bad = strings({ ...d, menu: { ...d.menu, otherLang: '' } }).filter((s) => BAD.test(s))
    expect(bad).toEqual([])
    expect(d.menu.otherLang).toBe('Русский')
  })

  it('у каждой реплики голоса есть английский текст без русских букв', () => {
    const lines = Object.values(LINES).flat() as { id: string; en?: string }[]
    expect(lines.length).toBe(45)
    const bad = lines.filter((l) => !l.en || BAD.test(l.en)).map((l) => l.id)
    expect(bad).toEqual([])
  })

  it('язык переключается: подсказка о пальцах на нужном языке', () => {
    useLang.getState().setLang('ru')
    expect(t().hints.fistPartial(['безымянный', 'мизинец'])).toContain('не согнуты')
    useLang.getState().setLang('en')
    expect(t().hints.fistPartial(['ring', 'pinky'])).toBe('To jump, close your fist all the way. Not bent: ring, pinky')
  })
})
