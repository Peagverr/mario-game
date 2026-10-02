import { decodeClip, type ClipFile, type HandClip } from '../clip'
import { proceduralClips } from '../proceduralClips'

/**
 * Все клипы голограммы по имени. Записи живой руки (`?record` → JSON) кладутся в эту папку
 * и заменяют процедурный клип с тем же именем — код менять не нужно.
 */

export type ClipName = 'palm-raise' | 'palm-move' | 'fist' | 'left-palm-sweep'
export const CLIP_NAMES: ClipName[] = ['palm-raise', 'palm-move', 'fist', 'left-palm-sweep']

const recorded = import.meta.glob<ClipFile>('./*.json', { eager: true, import: 'default' })

let cache: Map<string, HandClip> | null = null

function all() {
  if (cache) return cache
  cache = new Map(proceduralClips().map((c) => [c.name, c]))
  for (const [path, file] of Object.entries(recorded)) {
    try {
      cache.set(file.name, decodeClip(file))
    } catch (e) {
      console.warn(`[holo] запись ${path} не читается — остаётся процедурный клип`, e)
    }
  }
  return cache
}

export function getClip(name: string): HandClip {
  const c = all().get(name)
  if (!c) throw new Error(`[holo] нет клипа ${name}`)
  return c
}

/** Подменить клип на лету (свежая запись в `?record`). */
export function putClip(c: HandClip) {
  all().set(c.name, c)
}
