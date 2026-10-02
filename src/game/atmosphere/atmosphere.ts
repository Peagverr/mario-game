import { Color, MathUtils, Vector3 } from 'three'

/**
 * Время суток — одно число t от 0 до 1: ночь → синий час → золотой час → восход → утро.
 * Все цвета неба, солнце, свет, туман и звёзды — здесь, в одном месте (так просит задание на 3D-мир).
 * Каждая сцена ставит свою точку (SCENE_TIME): игрок проходит игру от ночи к рассвету.
 */

export type AtmoKey = {
  t: number
  skyTop: string
  skyHorizon: string
  /** Низ неба — бездна под островами; туман того же цвета. */
  skyBottom: string
  /** Высота солнца над горизонтом, градусы (ниже нуля — ещё не взошло). */
  sunElevation: number
  sunColor: string
  /** Сила ключевого света (солнце днём, луна ночью). */
  keyIntensity: number
  /** Цвет ключевого света: ночью холодная луна, на рассвете тёплое солнце. */
  keyColor: string
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  /** Туман: с какого расстояния ЗА героем начинается и где мир тонет целиком (от героя, а не от камеры — одинаково в лобби и на уровнях). */
  fogNear: number
  fogFar: number
  stars: number
  cloud: string
}

/** Ключевые моменты суток. Между ними цвета и числа плавно смешиваются. */
export const KEYS: AtmoKey[] = [
  {
    t: 0,
    skyTop: '#03060f',
    skyHorizon: '#16203f',
    skyBottom: '#070b1a',
    sunElevation: -14,
    sunColor: '#ff8a5a',
    keyIntensity: 1.35,
    keyColor: '#a9b8ff',
    hemiSky: '#4c63a6',
    hemiGround: '#161c36',
    hemiIntensity: 1.0,
    fogNear: 4,
    fogFar: 62,
    stars: 1,
    cloud: '#2a3354',
  },
  {
    t: 0.3,
    skyTop: '#0b1734',
    skyHorizon: '#3f4673',
    skyBottom: '#10162f',
    sunElevation: -6,
    sunColor: '#ff8a5a',
    keyIntensity: 1.35,
    keyColor: '#a3b2ff',
    hemiSky: '#5a6cad',
    hemiGround: '#1f2038',
    hemiIntensity: 1.0,
    fogNear: 6,
    fogFar: 72,
    stars: 0.65,
    cloud: '#454c72',
  },
  {
    t: 0.55,
    skyTop: '#22356a',
    skyHorizon: '#f28a55',
    skyBottom: '#33304c',
    sunElevation: 1.5,
    sunColor: '#ff9a5c',
    keyIntensity: 1.9,
    keyColor: '#ffab78',
    hemiSky: '#7d84b8',
    hemiGround: '#3f2a3a',
    hemiIntensity: 0.9,
    fogNear: 10,
    fogFar: 88,
    stars: 0.18,
    cloud: '#c88a82',
  },
  {
    t: 0.8,
    skyTop: '#3f6fb8',
    skyHorizon: '#ffbf7a',
    skyBottom: '#7f93bf',
    sunElevation: 9,
    sunColor: '#ffc98c',
    keyIntensity: 2.3,
    keyColor: '#ffd29a',
    hemiSky: '#b2c2ec',
    hemiGround: '#735649',
    hemiIntensity: 0.95,
    fogNear: 16,
    fogFar: 105,
    stars: 0,
    cloud: '#ffd9bb',
  },
  {
    t: 1,
    skyTop: '#5a9fe6',
    skyHorizon: '#ffe1b4',
    skyBottom: '#a6c6ea',
    sunElevation: 17,
    sunColor: '#fff0d4',
    keyIntensity: 2.5,
    keyColor: '#fff0d8',
    hemiSky: '#dcecff',
    hemiGround: '#ffd6a6',
    hemiIntensity: 1.05,
    fogNear: 22,
    fogFar: 130,
    stars: 0,
    cloud: '#fff6ec',
  },
]

/** Время суток по сценам (таблица из задания на 3D-мир). Итоги — рассвет. */
export const SCENE_TIME = { lobby: 0.1, level1: 0.35, level2: 0.6, level3: 0.85 } as const
export const RESULTS_TIME = 1

/** Солнце встаёт с этой стороны (градусы от «вглубь экрана» по часовой): позади островов, чуть левее — светит в контражур, как на референсе. */
const SUN_AZIMUTH = -28

export type Atmo = {
  t: number
  skyTop: Color
  skyHorizon: Color
  skyBottom: Color
  sunColor: Color
  keyColor: Color
  hemiSky: Color
  hemiGround: Color
  cloud: Color
  /** Направление на солнце (единичный вектор, может быть под горизонтом). */
  sunDir: Vector3
  /** Направление ключевого света: ночью — луна сверху, к восходу — солнце. */
  keyDir: Vector3
  keyIntensity: number
  hemiIntensity: number
  fogNear: number
  fogFar: number
  stars: number
  /** Насколько видно солнце и свечение вокруг него (0 — глубокая ночь). */
  sunGlow: number
}

export function createAtmo(): Atmo {
  return {
    t: 0,
    skyTop: new Color(),
    skyHorizon: new Color(),
    skyBottom: new Color(),
    sunColor: new Color(),
    keyColor: new Color(),
    hemiSky: new Color(),
    hemiGround: new Color(),
    cloud: new Color(),
    sunDir: new Vector3(),
    keyDir: new Vector3(),
    keyIntensity: 0,
    hemiIntensity: 0,
    fogNear: 0,
    fogFar: 0,
    stars: 0,
    sunGlow: 0,
  }
}

/** Луна ночью светит сверху-сбоку: так острова читаются, а не тонут в темноте. */
const MOON_DIR = new Vector3(0.45, 0.8, 0.35).normalize()
const ca = new Color()
const cb = new Color()

function mixColor(out: Color, a: string, b: string, k: number) {
  return out.copy(ca.set(a)).lerp(cb.set(b), k)
}

/** Направление на солнце по высоте над горизонтом (градусы). */
export function sunDirection(elevationDeg: number, out = new Vector3()) {
  const el = MathUtils.degToRad(elevationDeg)
  const az = MathUtils.degToRad(SUN_AZIMUTH)
  // «Вглубь экрана» — это −z (камера по умолчанию смотрит туда).
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize()
}

/** Атмосфера для времени суток t (пишет в out, без новых объектов — вызывается каждый кадр). */
export function sampleAtmo(t: number, out: Atmo = createAtmo()): Atmo {
  const tt = MathUtils.clamp(t, 0, 1)
  let i = 0
  while (i < KEYS.length - 2 && tt > KEYS[i + 1].t) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const k = MathUtils.smoothstep(tt, a.t, b.t)
  const n = (x: number, y: number) => x + (y - x) * k

  out.t = tt
  mixColor(out.skyTop, a.skyTop, b.skyTop, k)
  mixColor(out.skyHorizon, a.skyHorizon, b.skyHorizon, k)
  mixColor(out.skyBottom, a.skyBottom, b.skyBottom, k)
  mixColor(out.sunColor, a.sunColor, b.sunColor, k)
  mixColor(out.keyColor, a.keyColor, b.keyColor, k)
  mixColor(out.hemiSky, a.hemiSky, b.hemiSky, k)
  mixColor(out.hemiGround, a.hemiGround, b.hemiGround, k)
  mixColor(out.cloud, a.cloud, b.cloud, k)
  out.keyIntensity = n(a.keyIntensity, b.keyIntensity)
  out.hemiIntensity = n(a.hemiIntensity, b.hemiIntensity)
  out.fogNear = n(a.fogNear, b.fogNear)
  out.fogFar = n(a.fogFar, b.fogFar)
  out.stars = n(a.stars, b.stars)

  const elevation = n(a.sunElevation, b.sunElevation)
  sunDirection(elevation, out.sunDir)
  // Свечение у горизонта появляется ещё до восхода (с −10°), к восходу — полное.
  out.sunGlow = MathUtils.smoothstep(elevation, -10, 2)
  // Ключевой свет: пока солнце низко — светит луна, потом свет переходит к солнцу. Для теней солнце «поднято»
  // до 32° (диск в небе остаётся низко): иначе тени тянутся полосами через весь остров.
  const toSun = MathUtils.smoothstep(elevation, -4, 4)
  const sunKey = sunDirection(Math.max(elevation, 32), new Vector3())
  out.keyDir.copy(MOON_DIR).lerp(sunKey, toSun).normalize()
  return out
}

/** Плавный переход времени суток: за ~3 с почти доходит до цели (при смене сцены). */
export function approachTime(current: number, target: number, dt: number, seconds = 1.1) {
  return current + (target - current) * (1 - Math.exp(-dt / seconds))
}
