import { Box3, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { cameraOffset, PITCH } from '../../windowParams'
import { courtyardWalls, level2, SECRET_STAR_HEIGHT, SEEN_POINTS, starSamplePoints, type Courtyard } from './levelData'

/**
 * Уровень «Загляни» считается по тем же формулам, что и игра: камера-окно (windowParams.ts),
 * стены двориков и точки звезды (levelData.ts). Звезда засчитана, когда с камеры видно
 * SEEN_POINTS её точек — луч от камеры до точки не упирается в стены (как проверка в Level2.tsx).
 */

/** Высота центра героя над полом, за ним следит камера. */
const HERO_CENTER = 0.7

function wallBoxes(c: Courtyard) {
  return courtyardWalls(c).map((w) =>
    new Box3().setFromCenterAndSize(new Vector3(c.x + w.pos[0], c.top + w.pos[1], c.z + w.pos[2]), new Vector3(...w.size)),
  )
}

function visibleCount(cam: Vector3, c: Courtyard) {
  const boxes = wallBoxes(c)
  return starSamplePoints([c.x, c.top + SECRET_STAR_HEIGHT, c.z], [1, 0, 0]).filter((p) => {
    const target = new Vector3(...p)
    const dir = target.clone().sub(cam)
    const dist = dir.length()
    const ray = new Ray(cam, dir.normalize())
    return !boxes.some((b) => {
      const hit = ray.intersectBox(b, new Vector3())
      return hit && hit.distanceTo(cam) < dist - 0.05
    })
  }).length
}

/** Где можно стоять рядом с двориком (с любой из четырёх сторон) — только на острове того же уровня. */
function standSpots(c: Courtyard, distances: number[]) {
  const half = c.size / 2
  return distances
    .flatMap((d) => [
      new Vector3(c.x, c.top + HERO_CENTER, c.z + half + d),
      new Vector3(c.x, c.top + HERO_CENTER, c.z - half - d),
      new Vector3(c.x + half + d, c.top + HERO_CENTER, c.z),
      new Vector3(c.x - half - d, c.top + HERO_CENTER, c.z),
    ])
    .filter((p) =>
      level2.platforms.some(
        (pl) => pl.top === c.top && Math.abs(p.x - pl.x) < pl.w / 2 - 0.4 && Math.abs(p.z - pl.z) < pl.d / 2 - 0.4,
      ),
    )
}

/** Сколько точек звезды видно, если герой стоит в focus, голова сдвинута на headY (м), мир наклонён на pitch. */
function seen(c: Courtyard, focus: Vector3, headY: number, pitch = PITCH) {
  return visibleCount(focus.clone().add(cameraOffset({ x: 0, y: headY, z: 0 }, pitch, 0)), c)
}

describe('уровень «Загляни»: тайные звёзды в двориках', () => {
  it('у каждого дворика есть где встать перед ним', () => {
    for (const c of level2.courtyards) expect(standSpots(c, [0.8, 1.5, 3]).length).toBeGreaterThan(0)
  })

  it('голова на месте (и чуть покачивается) — звёзд не видно: прячутся за стенами', () => {
    for (const c of level2.courtyards)
      for (const focus of standSpots(c, [0.8, 1.5, 3, 5]))
        for (const headY of [-0.02, 0, 0.02]) expect(seen(c, focus, headY)).toBeLessThan(SEEN_POINTS)
  })

  it('подними голову на 7,5 см — видно каждую звезду, откуда ни смотри', () => {
    for (const c of level2.courtyards)
      for (const focus of standSpots(c, [0.8, 1.5, 3])) expect(seen(c, focus, 0.075)).toBeGreaterThanOrEqual(SEEN_POINTS)
  })

  it('или потяни мир щипком вниз — видно и без головы', () => {
    for (const c of level2.courtyards)
      for (const focus of standSpots(c, [0.8, 1.5, 3])) expect(seen(c, focus, 0, PITCH + 0.4)).toBeGreaterThanOrEqual(SEEN_POINTS)
  })
})
