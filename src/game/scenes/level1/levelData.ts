/**
 * Уровень 1 «Парящие острова» — только данные. Чтобы поменять уровень, правь этот файл.
 * Единицы — примерно метры; герой высотой ~1.4.
 *
 * top — высота верхней поверхности, w/d — ширина/глубина, h — толщина.
 */

export type PlatformKind = 'island' | 'stone' | 'wood'

export type Platform = {
  x: number
  z: number
  top: number
  w: number
  d: number
  h: number
  kind: PlatformKind
  checkpoint?: boolean
  /** Движущаяся платформа: ось, размах и скорость (рад/с). */
  moving?: { axis: 'x' | 'z'; amp: number; speed: number }
  /** Деревья на острове (смещения от центра). */
  trees?: [number, number][]
}

export const level1 = {
  spawn: [0, 1.2, 0] as [number, number, number],
  platforms: [
    { x: 0, z: 0, top: 0, w: 8, d: 8, h: 2, kind: 'island', checkpoint: true, trees: [[-2.6, -2.4], [2.8, 2.6]] },
    { x: 6, z: -1, top: 0.3, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
    { x: 9, z: -2.5, top: 0.8, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
    { x: 14, z: -3, top: 1.2, w: 6, d: 6, h: 2.4, kind: 'island', checkpoint: true, trees: [[2, 1.8]] },
    { x: 14, z: -8.6, top: 1.2, w: 3, d: 3, h: 0.5, kind: 'wood', moving: { axis: 'x', amp: 1.8, speed: 0.8 } },
    { x: 14, z: -14, top: 1.6, w: 6, d: 5, h: 2.4, kind: 'island', checkpoint: true, trees: [[2.2, -1.5]] },
    { x: 9.6, z: -14, top: 2.3, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
    { x: 6.6, z: -14, top: 3.0, w: 2.6, d: 2.6, h: 0.6, kind: 'stone' },
    { x: 1, z: -14, top: 3.6, w: 7, d: 6, h: 2.6, kind: 'island', checkpoint: true, trees: [[-2.4, -2], [2.5, 1.8]] },
    { x: -5, z: -14, top: 3.6, w: 5, d: 2.2, h: 0.4, kind: 'wood' },
    { x: -10, z: -14, top: 3.6, w: 5, d: 5, h: 2.4, kind: 'island', checkpoint: true },
  ] satisfies Platform[] as Platform[],
  stars: [
    [-2, 1, -1.5],
    [6, 1.4, -1],
    [9, 1.9, -2.5],
    [13, 2.3, -2],
    [16, 2.3, -5],
    [14, 2.7, -8.6],
    [14.5, 2.7, -14],
    [6.6, 4.1, -14],
    [1, 4.7, -15],
    [-5, 4.7, -14],
  ] as [number, number, number][],
  goal: [-10.5, 3.6, -14.5] as [number, number, number],
  /** Ниже этой высоты герой считается упавшим. */
  killY: -10,
}
