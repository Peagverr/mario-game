import { OneEuro } from './oneEuro'

/**
 * Левый кулак — «умный джойстик» мира. Смесь двух способов (как RubberEdge у тачпадов, Casiez и др., 2007):
 *
 * - Рядом с местом, где сжал кулак, мир едет за рукой напрямую: повёл на 10 см — мир повернулся примерно на 45°.
 *   В любую сторону, по диагонали — поворот и наклон вместе.
 * - Увёл руку за край этой зоны (EDGE_M) — мир докручивается сам, чем дальше, тем быстрее.
 *   Так мир поворачивается сколько угодно, не перехватывая кулак.
 * - Кулак к камере или от неё — зум. Зум включается, только когда рука явно едет к камере, а не вбок
 *   (сравниваем за последние ~0,6 с), и выключается, как только рука снова явно повела вбок.
 *   Режим не «замерзает» на весь хват: разжимать кулак, чтобы сменить зум на поворот, не нужно.
 *
 * Расстояния — в метрах движения руки: масштаб руки на картинке (handScale) переводит доли кадра в метры,
 * поэтому неважно, близко сидишь или далеко.
 */

export type View = { yaw: number; pitch: number; zoom: number }
/**
 * Точка хвата: центр ладони в долях ширины и высоты кадра (зеркально) и масштаб руки на картинке —
 * сколько высот кадра занимает метр на том расстоянии, где рука (больше — рука ближе к камере).
 */
export type GrabPoint = { x: number; y: number; scale: number }
/** Что делает кулак сейчас: двигает мир (поворот и наклон вместе) или приближает. */
export type GrabAxis = 'move' | 'zoom'

/** Повёл кулак на метр — столько радиан поворота (10 см ≈ 46°)… */
const ROTATE_PER_M = 8
/** …и наклона (10 см ≈ 34°: наклону хватает меньшего хода, он упирается в пределы). */
const PITCH_PER_M = 6
/** Наклон от обычного вида: вниз — смотрим почти сверху, вверх — почти сбоку. */
const PITCH_MIN = -0.3
const PITCH_MAX = 0.55
const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.8
/** Зум = (во сколько раз выросла рука на картинке) в этой степени: 10 см к камере — примерно ×1.7. */
const ZOOM_POWER = 2.5

/** Зона, где мир едет за рукой (м от места хвата); дальше мир докручивается сам. */
export const EDGE_M = 0.09
/** За краем зоны на столько метров — полная скорость докрутки. */
const EDGE_RANGE_M = 0.08
/** Полная скорость докрутки: радиан в секунду поворота и наклона. */
const RATE_YAW = 2
const RATE_PITCH = 1.2

/** За сколько последних мс сравниваем «к камере» и «вбок». */
const WINDOW_MS = 600
/** Пока кулак сжимается, рука на картинке «плывёт» — зум в эти мс не включаем. */
const SETTLE_MS = 150
/** Зум включается, когда рука выросла (или уменьшилась) больше чем на 8%… */
const ZOOM_ENTER = Math.log(1.08)
/** …и это движение к камере заметно больше движения вбок. */
const DOMINANCE = 1.5
/** Перевод «рука выросла на картинке» в метры: рука примерно в полуметре от камеры. */
const HAND_DEPTH_M = 0.5
/** Включая зум, первые 4% роста не считаем — размер руки и так чуть «дышит». */
const ZOOM_DEADBAND = Math.log(1.04)
/** Из зума обратно в поворот — когда рука повела вбок больше чем на 3 см. */
const MOVE_BACK_M = 0.03
/** Рука повела больше чем на 1 см — подписываем «держишь мир». */
const MOVED_M = 0.01

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Sample = { t: number; px: number; py: number; l: number }

export class WorldGrab {
  /** Множитель чувствительности (меню: «медленнее / быстрее»). */
  speed = 1
  private view: View = { yaw: 0, pitch: 0, zoom: 1 }
  private aspect = 4 / 3
  private scale0 = 1
  private startT = 0
  private prev = { x: 0, y: 0, l: 0, t: 0 }
  /** Путь руки вбок и вверх-вниз с начала хвата, в метрах (без сдвига от приближения). */
  private path = { x: 0, y: 0 }
  /** Откуда считается зона «мир едет за рукой» — квадратные координаты кадра. */
  private anchor = { x: 0, y: 0 }
  private hist: Sample[] = []
  private mode: GrabAxis = 'move'
  private moved = false
  private settled = false
  private rateNow = 0
  private lFilter = new OneEuro(1, 0.5)

  /** Что делает кулак: null — ещё не решил (рука почти не двигалась). */
  get axis(): GrabAxis | null {
    if (this.mode === 'zoom') return 'zoom'
    return this.moved ? 'move' : null
  }

  /** Для мини-окна: где сжат кулак (доли кадра), радиус зоны (доли высоты кадра), насколько рука за краем (0..1). */
  get zone() {
    return { x: this.anchor.x / this.aspect, y: this.anchor.y, edge: EDGE_M * this.scale0, rate: this.rateNow }
  }

  /** Кулак сжался: запомнить, откуда тянем и какой был вид. */
  start(p: GrabPoint, view: View, aspect: number, t: number) {
    this.view = { ...view }
    this.aspect = aspect
    this.scale0 = p.scale > 0 ? p.scale : 1
    this.startT = t
    this.lFilter.reset()
    const l = this.lFilter.filter(Math.log(this.scale0), t)
    const x = p.x * aspect
    this.prev = { x, y: p.y, l, t }
    this.path = { x: 0, y: 0 }
    this.anchor = { x, y: p.y }
    this.hist = [{ t, px: 0, py: 0, l }]
    this.mode = 'move'
    this.moved = false
    this.settled = false
    this.rateNow = 0
  }

  /** Кулак держит мир дальше: новый вид мира. */
  move(p: GrabPoint, t: number): View {
    const k = this.aspect
    const x = p.x * k
    const y = p.y
    const l = this.lFilter.filter(Math.log(p.scale > 0 ? p.scale : this.scale0), t)
    const dt = clamp((t - this.prev.t) / 1000, 0, 0.1)

    // Рука едет к камере — точка хвата на картинке уезжает от центра кадра (перспектива).
    // Этот сдвиг — зум, а не «повести вбок»: убираем его, иначе толчок к камере крутил бы мир.
    let dx = x - this.prev.x
    let dy = y - this.prev.y
    const grow = Math.exp(l - this.prev.l) - 1
    const sx = (this.prev.x - 0.5 * k) * grow
    const sy = (this.prev.y - 0.5) * grow
    const ss = sx * sx + sy * sy
    const along = ss > 1e-12 ? clamp((dx * sx + dy * sy) / ss, 0, 1) : 0
    dx -= along * sx
    dy -= along * sy
    // В метры движения руки.
    const mx = dx / this.scale0
    const my = dy / this.scale0
    this.path.x += mx
    this.path.y += my
    const dl = l - this.prev.l
    this.prev = { x, y, l, t }

    // Пока кулак сжимается — только поворот; потом сравнение «к камере / вбок» начинается с чистого листа.
    if (!this.settled && t - this.startT >= SETTLE_MS) {
      this.settled = true
      this.hist = []
    }
    this.hist.push({ t, px: this.path.x, py: this.path.y, l })
    while (this.hist.length > 2 && t - this.hist[1].t > WINDOW_MS) this.hist.shift()
    const old = this.hist[0]
    const planar = Math.hypot(this.path.x - old.px, this.path.y - old.py)
    const depth = l - old.l
    const depthM = Math.abs(depth) * HAND_DEPTH_M

    const v = this.view
    if (this.mode === 'move' && this.settled && Math.abs(depth) > ZOOM_ENTER && depthM > DOMINANCE * planar) {
      // Рука явно поехала к камере (или от неё) — зум. Уже проделанный путь тоже засчитываем.
      this.mode = 'zoom'
      v.zoom = clamp(v.zoom * Math.exp(ZOOM_POWER * (depth - Math.sign(depth) * ZOOM_DEADBAND)), ZOOM_MIN, ZOOM_MAX)
      this.restartWindow(x, y, l, t)
    } else if (this.mode === 'zoom' && planar > MOVE_BACK_M && planar > DOMINANCE * depthM) {
      // Явно повёл вбок — снова двигаем мир, зона «едет за рукой» начинается отсюда.
      this.mode = 'move'
      this.restartWindow(x, y, l, t)
    } else if (this.mode === 'zoom') {
      v.zoom = clamp(v.zoom * Math.exp(ZOOM_POWER * dl), ZOOM_MIN, ZOOM_MAX)
    }

    this.rateNow = 0
    if (this.mode === 'move') {
      const g = this.speed
      v.yaw += mx * ROTATE_PER_M * g
      v.pitch += my * PITCH_PER_M * g
      // За краем зоны мир докручивается сам — в ту сторону, куда увёл руку.
      const ox = (x - this.anchor.x) / this.scale0
      const oy = (y - this.anchor.y) / this.scale0
      const d = Math.hypot(ox, oy)
      this.rateNow = clamp((d - EDGE_M) / EDGE_RANGE_M, 0, 1)
      if (this.rateNow > 0) {
        v.yaw += (ox / d) * this.rateNow * RATE_YAW * g * dt
        v.pitch += (oy / d) * this.rateNow * RATE_PITCH * g * dt
      }
      if (Math.hypot(this.path.x, this.path.y) > MOVED_M) this.moved = true
    }
    v.pitch = clamp(v.pitch, PITCH_MIN, PITCH_MAX)
    return { ...v }
  }

  private restartWindow(x: number, y: number, l: number, t: number) {
    this.anchor = { x, y }
    this.hist = [{ t, px: this.path.x, py: this.path.y, l }]
  }
}

/** Типичная длина ладони (запястье → основание среднего пальца), м — если объёмных точек нет. */
const PALM_M = 0.085
/** Кости ладони вдоль руки и поперёк: пальцы их не меняют, кулак тоже. */
const ALONG: [number, number][] = [[0, 5], [0, 9], [0, 13], [0, 17]]
const ACROSS: [number, number][] = [[5, 17], [5, 13], [9, 17]]

type P3 = { x: number; y: number; z: number }

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Масштаб руки на картинке: сколько высот кадра занимает метр там, где рука. Больше — рука ближе к камере.
 *
 * Раньше брали одну кость (запястье → средний палец) на картинке, и она «росла», просто когда кисть
 * поворачивалась, — мир сам приближался. Теперь каждую кость ладони делим на её настоящую длину
 * (объёмные точки MediaPipe, в метрах): поворот укорачивает на картинке кости одного направления,
 * но не всех сразу. Берём медиану вдоль руки и медиану поперёк и из них большее.
 */
export function handScale(points: P3[], world: P3[] | undefined, aspect: number) {
  const img = (a: number, b: number) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y)
  const real = (a: number, b: number) => Math.hypot(world![a].x - world![b].x, world![a].y - world![b].y, world![a].z - world![b].z)
  // Объёмных точек нет (или это не метры) — по одной кости и типичной длине ладони.
  if (!world || world.length < 21 || !(real(0, 9) > 0.02 && real(0, 9) < 0.3)) return img(0, 9) / PALM_M
  const ratios = (bones: [number, number][]) => bones.map(([a, b]) => img(a, b) / (real(a, b) || 1e-6))
  return Math.max(median(ratios(ALONG)), median(ratios(ACROSS)))
}
