/**
 * КОНТРАКТ между распознаванием (src/input) и игрой (src/game).
 *
 * Распознавание только ПИШЕТ в `control`, игра и интерфейс только ЧИТАЮТ.
 * Объект изменяется на месте каждый кадр камеры (без React-состояния),
 * поэтому в игре его читают внутри useFrame / requestAnimationFrame.
 *
 * Менять форму этого файла — только договорившись вдвоём.
 */

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }

/** Точка руки/лица в координатах кадра, уже ЗЕРКАЛЬНО (как в зеркале): x 0..1 слева направо, y 0..1 сверху вниз. */
export type Point = { x: number; y: number; z: number }

export type HintCode =
  | 'no-face'
  | 'too-close'
  | 'too-far'
  | 'head-turned'
  | 'dark'
  | 'hand-edge'
  | 'fist-partial'
  | 'pinch-partial'
  | 'joystick-far'
  | 'wrong-hand'
  | 'no-hands'

export type Hint = {
  code: HintCode
  /** Конкретная подсказка: что не так и что сделать. */
  text: string
  /** Какая рука виновата — чтобы подсветить её на скелете. */
  hand?: 'left' | 'right'
  /** Индексы точек руки, которые подсветить красным (например, несогнутые пальцы). */
  landmarks?: number[]
  /** Направление стрелки подсказки на экране. */
  arrow?: 'left' | 'right' | 'up' | 'down' | 'closer' | 'farther'
}

export type FingerCurl = 'extended' | 'half' | 'curled'

export type HandState = {
  present: boolean
  /** 21 точка MediaPipe, зеркальные координаты. */
  points: Point[]
  /** Размер ладони в кадре (запястье → основание среднего пальца), для порогов, не зависящих от расстояния. */
  size: number
  /** Центр ладони (стабилен, когда сжимаешь кулак). */
  palm: Point
  /** Состояние пальцев: [большой, указательный, средний, безымянный, мизинец]. */
  curls: FingerCurl[]
  fist: boolean
  openPalm: boolean
  /** Расстояние большой–указательный относительно размера ладони (0 = сомкнуты). */
  pinchRatio: number
  pinching: boolean
  /** Встроенный жест MediaPipe (Closed_Fist, Open_Palm, …) — для справки. */
  gesture: string
}

export type Phase = 'start' | 'loading' | 'tutorial' | 'countdown' | 'playing' | 'paused' | 'results'

export const control = {
  tracking: {
    /** Камера и модели загружены, кадры идут. */
    ready: false,
    /** Кадров распознавания в секунду. */
    fps: 0,
    /** Средняя яркость кадра 0..1. */
    brightness: 1,
    /** Видео с камеры (для мини-окна со скелетом). */
    video: null as HTMLVideoElement | null,
  },

  /** Положение головы относительно ЦЕНТРА ЭКРАНА, в метрах. x вправо, y вверх, z — расстояние до экрана. */
  head: { x: 0, y: 0, z: 0.6, visible: false, yawDeg: 0 },

  /** Джойстик правой рукой: x вправо, y «вперёд» (рука вверх). Диапазон −1..1. */
  move: { x: 0, y: 0 } as Vec2,

  /** Счётчик прыжков: игра запоминает прошлое значение и прыгает, когда оно выросло. */
  jumpSeq: 0,

  /** Левая рука «держит мир»: поворот (радианы) и приближение (1 = обычный вид). */
  view: { yaw: 0, zoom: 1, grabbing: false },

  /** Счётчик пауз (обе ладони раскрыты ~1 сек). */
  pauseSeq: 0,

  /** Курсор для меню: 0..1 от левого верхнего угла экрана. */
  cursor: { x: 0.5, y: 0.5, visible: false },

  hands: {
    left: null as HandState | null,
    right: null as HandState | null,
  },

  /** Точки лица для мини-окна (зрачки, контур) — зеркальные координаты. */
  face: { points: [] as Point[] },

  /** Активные подсказки «режима ошибки» (уже отфильтрованы от мигания). */
  hints: [] as Hint[],

  /** Режим разработки: управление с клавиатуры включено (только `npm run dev`). */
  devKeyboard: false,
}

export type ControlState = typeof control
