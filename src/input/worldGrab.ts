/**
 * Щипок левой «держит мир»: повёл в сторону — мир повернулся, вверх-вниз — наклонился,
 * к камере или от неё — приблизился или отдалился.
 *
 * Первые движения щипка решают, что ты делаешь: ведёшь руку (в любую сторону) — мир крутится и наклоняется
 * одновременно, как если бы держал его рукой; к камере или от неё — только зум (чтобы толчок к камере не крутил мир).
 * Хочешь зум после поворота или наоборот — отпусти и щипни заново: вид продолжится с того же места.
 */

export type View = { yaw: number; pitch: number; zoom: number }
/** Точка щипка — в долях ширины и высоты кадра (зеркально), размер ладони — в долях высоты кадра. */
export type PinchPoint = { x: number; y: number; size: number }
/** Что делает этот щипок: двигает мир (поворот и наклон вместе) или приближает. */
export type GrabAxis = 'move' | 'zoom'

/** Провести щипком через весь кадр по горизонтали = столько радиан поворота. */
const ROTATE_GAIN = Math.PI * 1.6
/** Через весь кадр по вертикали = столько радиан наклона. Вверх-вниз рука ходит меньше — поэтому чувствительнее. */
const PITCH_GAIN = 2.8
/** Наклон от обычного вида: вниз — смотрим почти сверху, вверх — почти сбоку. */
const PITCH_MIN = -0.3
const PITCH_MAX = 0.55
const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.8
/** Зум = (во сколько раз выросла ладонь на картинке) в этой степени: 10 см к камере — примерно ×1.6. */
const ZOOM_POWER = 2.5
/** Размер ладони чуть «дышит» даже у неподвижной руки — изменения меньше этой доли не зумят. */
const ZOOM_DEADBAND = 0.04
/** После такого сдвига (в долях высоты кадра) выбирается «двигаю мир»… */
const LOCK_DIST = 0.025
/** …а после такого изменения размера ладони — зум (≈4 см к камере). Что наступило раньше, то и выбрано. */
const ZOOM_LOCK = 0.08

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export class WorldGrab {
  private from: PinchPoint = { x: 0, y: 0, size: 1 }
  private view: View = { yaw: 0, pitch: 0, zoom: 1 }
  private current: View = { yaw: 0, pitch: 0, zoom: 1 }
  private aspect = 4 / 3
  private locked: GrabAxis | null = null

  /** Что делает текущий щипок; null — ещё не решил (рука почти не двигалась). */
  get axis() {
    return this.locked
  }

  /** Щипок начался: запомнить, откуда тянем и какой был вид. */
  start(p: PinchPoint, view: View, aspect: number) {
    this.from = { ...p }
    this.view = { ...view }
    this.current = { ...view }
    this.aspect = aspect
    this.locked = null
  }

  /** Щипок продолжается: новый вид мира. */
  move(p: PinchPoint): View {
    const ratio = p.size / (this.from.size || 1e-6)
    const k = this.aspect
    // Сдвиг точки щипка — в «квадратных» координатах (x·ширина/высота кадра), где x и y сравнимы.
    const mx = (p.x - this.from.x) * k
    const my = p.y - this.from.y
    // Рука едет к камере или от неё — точка щипка на картинке смещается вдоль луча от центра кадра:
    // от нуля (рука идёт прямо на объектив) до (старт − центр)·(ratio − 1) (параллельно оси камеры).
    // Такой сдвиг — это зум, а не «повести в сторону»: убираем его, иначе толчок к камере крутил бы мир.
    const sx = (this.from.x - 0.5) * k * (ratio - 1)
    const sy = (this.from.y - 0.5) * (ratio - 1)
    const ss = sx * sx + sy * sy
    const along = ss > 1e-12 ? clamp((mx * sx + my * sy) / ss, 0, 1) : 0
    const ux = mx - along * sx
    const uy = my - along * sy
    const dx = ux / k
    const dy = uy

    if (!this.locked) {
      const ax = Math.abs(ux)
      const ay = Math.abs(uy)
      const planar = Math.hypot(ax, ay) / LOCK_DIST
      const depth = Math.abs(Math.log(ratio)) / Math.log(1 + ZOOM_LOCK)
      if (planar >= 1 || depth >= 1) {
        this.locked = depth >= planar ? 'zoom' : 'move'
      }
    }
    const a = this.locked
    // Зум не крутит и не наклоняет; «двигаю мир» (и пока не решил) — поворот и наклон вместе.
    const yaw = a === 'zoom' ? this.current.yaw : this.view.yaw + dx * ROTATE_GAIN
    // «Схватил мир и потянул вниз» — дальний край мира опускается, смотрим сверху; вверх — сбоку.
    const pitch = a === 'zoom' ? this.current.pitch : clamp(this.view.pitch + dy * PITCH_GAIN, PITCH_MIN, PITCH_MAX)
    let zoom = this.current.zoom
    if (!a || a === 'zoom') {
      // Рука ближе к камере → ладонь крупнее → приближаем мир (мелкие колебания размера не считаем).
      const l = Math.log(ratio)
      const beyond = Math.sign(l) * Math.max(0, Math.abs(l) - Math.log(1 + ZOOM_DEADBAND))
      zoom = clamp(this.view.zoom * Math.exp(ZOOM_POWER * beyond), ZOOM_MIN, ZOOM_MAX)
    }

    this.current = { yaw, pitch, zoom }
    return this.current
  }
}
