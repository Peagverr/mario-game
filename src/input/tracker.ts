import { FaceLandmarker, FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { control, type HandState, type Point } from '../shared/controlState'
import { useGame } from '../shared/gameStore'
import { detectCandidates, HintFilter } from './errors'
import { HandTracker, POINT_MIN_LEN } from './gestures'
import { estimateHead, FACE_PREVIEW_POINTS, yawFromMatrix } from './head'
import { OneEuro3 } from './oneEuro'

/**
 * Цикл распознавания: камера → MediaPipe (руки + лицо) → наши правила → `control`.
 * Весь код игры читает только `control` и ничего не знает о MediaPipe.
 */

const GESTURE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`

/** Рабочая зона джойстика в размерах ладони: сдвиг на столько = полный ход (~4 см у взрослого). */
const JOYSTICK_RANGE = 0.5
/** Сдвиг меньше этой доли зоны не двигает героя — чтобы дрожание руки не считалось ходьбой. */
const JOYSTICK_DEADZONE = 0.14
/** Вниз рука двигается хуже (мешают стол и локоть), поэтому вниз нужно меньшее движение. */
const JOYSTICK_DOWN_GAIN = 1.3
/**
 * MediaPipe в этой версии называет руки правильно для нашего (не отзеркаленного) кадра.
 * Если руки снова окажутся перепутаны — поменять на true.
 */
const SWAP_HANDEDNESS = false
/** Сколько мс держать щипок, если левую руку на мгновение потеряли. */
const GRAB_LOST_GRACE_MS = 250
control.joystick.deadzone = JOYSTICK_DEADZONE
/** Поворот мира: провести щипком через весь кадр = столько радиан. */
const GRAB_ROTATE_GAIN = Math.PI * 1.6
/** Наклон мира: провести щипком через весь кадр по вертикали = столько радиан. */
const GRAB_PITCH_GAIN = 1.4
const PITCH_LIMIT = 0.35
/** Две раскрытые ладони столько держать, чтобы открылось меню. */
const MENU_HOLD_MS = 800
/** Кулак сжат вскоре после указания — прыгаем в ту же сторону (направление «запоминается»). */
const POINT_LATCH_MS = 600
/** Короткий зазор при переходе кулак → палец, чтобы герой не дёргался. */
const POINT_GAP_MS = 150
const JUMP_COOLDOWN_MS = 250

let recognizer: GestureRecognizer | null = null
let face: FaceLandmarker | null = null
let video: HTMLVideoElement | null = null
let running = false

const trackers = { left: new HandTracker(), right: new HandTracker() }
// Голова: быстрее реагирует на движение (эффект окна не должен запаздывать), в покое всё ещё гладко.
const headFilter = new OneEuro3(1.6, 3)
const hintFilter = new HintFilter()

/** Внутреннее состояние жестов между кадрами. */
const s = {
  joyCenter: { x: 0.64, y: 0.62 },
  wasFist: false,
  lastJump: 0,
  grab: null as null | { x: number; y: number; yaw: number; pitch: number; size: number; zoom: number },
  pauseSince: 0,
  pauseArmed: true,
  /** Последнее направление пальца и когда оно было. */
  lastPointDir: { x: 0, y: 0 },
  lastPointAt: 0,
  /** Направление, «запомненное» на время кулака. */
  latchedDir: null as null | { x: number; y: number },
  lastHandsAt: 0,
  lastFaceAt: 0,
  onlyLeftSince: 0,
  lastRightAt: 0,
  /** Когда левая рука пропала посреди щипка (скорее всего, повернулась ребром к камере). */
  leftLostWhilePinchAt: 0,
  wasLeftPinching: false,
  frame: 0,
  lastFrameAt: 0,
  lastVideoTime: -1,
}

export type TrackerStatus = 'camera' | 'models' | 'ready'

/** Запоминает текущее положение правой ладони как «нулевую точку» джойстика. */
export function calibrateJoystick() {
  const r = control.hands.right
  if (r) s.joyCenter = { x: r.palm.x, y: r.palm.y }
}

async function createTasks() {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
  const make = async (delegate: 'GPU' | 'CPU') =>
    Promise.all([
      GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        // Пониже, чтобы уже найденная рука не терялась при повороте (ребром к камере её почти не видно).
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      }),
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      }),
    ])
  try {
    return await make('GPU')
  } catch (e) {
    console.warn('[tracker] GPU недоступен, переключаюсь на CPU', e)
    return make('CPU')
  }
}

export async function startTracking(onStatus: (s: TrackerStatus) => void) {
  if (running) return
  onStatus('camera')
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  })
  video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  control.tracking.video = video

  onStatus('models')
  ;[recognizer, face] = await createTasks()

  running = true
  control.tracking.ready = true
  onStatus('ready')
  requestAnimationFrame(loop)
}

function loop() {
  if (!running || !video || !recognizer || !face) return
  requestAnimationFrame(loop)
  if (video.readyState < 2 || video.currentTime === s.lastVideoTime) return
  s.lastVideoTime = video.currentTime

  const t = performance.now()
  const t0 = performance.now()
  const hands = recognizer.recognizeForVideo(video, t)
  processHands(hands, t)
  // Лицо — через кадр: голова движется плавно, а руки важнее для отклика. Экономит ~40% времени распознавания.
  if (s.frame % 2 === 0) processFace(face.detectForVideo(video, t), t)
  control.tracking.inferMs += (performance.now() - t0 - control.tracking.inferMs) * 0.1
  if (s.frame++ % 15 === 0) measureBrightness(video)
  updateHints(t)

  const dt = t - s.lastFrameAt
  s.lastFrameAt = t
  if (dt > 0 && dt < 1000) control.tracking.fps += (1000 / dt - control.tracking.fps) * 0.1
}

const mirror = (p: { x: number; y: number; z: number }): Point => ({ x: 1 - p.x, y: p.y, z: p.z })

function processHands(res: ReturnType<GestureRecognizer['recognizeForVideo']>, t: number) {
  const aspect = video!.videoWidth / video!.videoHeight
  const found: { side: 'left' | 'right'; points: Point[]; world: Point[]; gesture: string }[] = []

  res.landmarks.forEach((lm, i) => {
    const points = lm.map(mirror)
    const world = (res.worldLandmarks[i] ?? []).map((p) => ({ x: -p.x, y: p.y, z: p.z }))
    const label = res.handedness[i]?.[0]?.categoryName
    const isRight = SWAP_HANDEDNESS ? label === 'Left' : label === 'Right'
    found.push({ side: isRight ? 'right' : 'left', points, world, gesture: res.gestures[i]?.[0]?.categoryName ?? 'None' })
  })
  // Если две руки получили одинаковую метку — решаем по положению: правее на экране = правая.
  if (found.length === 2 && found[0].side === found[1].side) {
    const [a, b] = found
    const aRight = a.points[0].x > b.points[0].x
    a.side = aRight ? 'right' : 'left'
    b.side = aRight ? 'left' : 'right'
  }

  const next: { left: HandState | null; right: HandState | null } = { left: null, right: null }
  for (const f of found) next[f.side] = trackers[f.side].update(f.points, f.world, f.gesture, aspect, t)
  if (!next.left) trackers.left.reset()
  if (!next.right) trackers.right.reset()
  if (!next.left && s.wasLeftPinching) s.leftLostWhilePinchAt = t
  if (next.left) s.leftLostWhilePinchAt = 0
  s.wasLeftPinching = !!next.left?.pinching
  control.hands.left = next.left
  control.hands.right = next.right
  if (next.left || next.right) s.lastHandsAt = t
  if (next.left && !next.right && next.left.openPalm && !next.left.pinching) {
    if (!s.onlyLeftSince) s.onlyLeftSince = t
  } else s.onlyLeftSince = 0

  // Правая рука появилась после перерыва — где она сейчас, там и центр джойстика.
  if (next.right) {
    // …но только если рука появилась в середине кадра: у края она чаще всего «вывалилась» и вернулась.
    const p = next.right.palm
    const central = p.x > 0.3 && p.x < 0.85 && p.y > 0.25 && p.y < 0.8
    if (t - s.lastRightAt > 800 && central) s.joyCenter = { x: p.x, y: p.y }
    s.lastRightAt = t
  }
  if (control.scheme === 'pointer') applyPointer(next.right, t)
  else applyJoystick(next.right)
  applyJump(next.right, t)
  applyGrab(next.left)
  applyMenu(found.length === 2 ? [next.left, next.right] : [], t)
  applyCursor(next.right ?? next.left)
}

function shape(v: number) {
  const a = Math.abs(v)
  if (a < JOYSTICK_DEADZONE) return 0
  return Math.sign(v) * Math.min(1, (a - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE))
}

let joystickReach = 0
function applyJoystick(r: HandState | null) {
  control.joystick.active = !!r
  if (!r) {
    control.move.x = 0
    control.move.y = 0
    control.joystick.x = 0
    control.joystick.y = 0
    joystickReach = 0
    return
  }
  const range = r.size * JOYSTICK_RANGE || 0.1
  let dx = (r.palm.x - s.joyCenter.x) / range
  let dy = (r.palm.y - s.joyCenter.y) / range
  if (dy > 0) dy *= JOYSTICK_DOWN_GAIN
  joystickReach = Math.hypot(dx, dy)
  // «Плавающий» центр, как у джойстиков в мобильных играх: увёл руку дальше края зоны —
  // центр подтягивается следом, и возвращать руку издалека не нужно.
  // Дальше края зоны — просто полный ход. Центр НЕ двигаем: иначе возврат руки в покой
  // читался как движение в обратную сторону.
  if (joystickReach > 1) {
    dx /= joystickReach
    dy /= joystickReach
  }
  control.move.x = shape(dx)
  control.move.y = shape(-dy)
  control.joystick.x = dx
  control.joystick.y = -dy
}

/** Ходьба пальцем: показываешь — идёт туда, раскрыл ладонь или опустил руку — стоит. */
function applyPointer(r: HandState | null, t: number) {
  control.joystick.active = !!r
  joystickReach = 0
  let dir: { x: number; y: number } | null = null

  if (r?.pointing && r.pointLen > POINT_MIN_LEN) {
    dir = r.pointDir
    s.lastPointDir = { ...r.pointDir }
    s.lastPointAt = t
  }
  // Кулак сразу после указания — прыжок в ту же сторону: направление держим, пока кулак сжат.
  if (r?.fist) {
    if (!s.latchedDir && t - s.lastPointAt < POINT_LATCH_MS) s.latchedDir = { ...s.lastPointDir }
    if (s.latchedDir) dir = s.latchedDir
  } else {
    s.latchedDir = null
    // Переход кулак → палец длится пару кадров — не останавливаем героя на это мгновение.
    if (!dir && r && !r.openPalm && t - s.lastPointAt < POINT_GAP_MS) dir = s.lastPointDir
  }

  control.move.x = dir ? dir.x : 0
  control.move.y = dir ? dir.y : 0
  control.joystick.x = control.move.x
  control.joystick.y = control.move.y
}

function applyJump(r: HandState | null, t: number) {
  const fist = !!r?.fist
  control.jumpHeld = fist
  if (fist && !s.wasFist && t - s.lastJump > JUMP_COOLDOWN_MS) {
    control.jumpSeq++
    s.lastJump = t
    if (useGame.getState().phase === 'playing') useGame.getState().countJump()
  }
  s.wasFist = fist
}

let lastGrabAt = 0
function applyGrab(l: HandState | null) {
  const t = performance.now()
  // Руку на мгновение потеряли посреди щипка — не бросаем мир, ждём.
  if (!l && s.grab && t - lastGrabAt < GRAB_LOST_GRACE_MS) return
  const pinching = !!l?.pinching
  control.view.grabbing = pinching
  if (!l || !pinching) {
    s.grab = null
    return
  }
  lastGrabAt = t
  const x = (l.points[4].x + l.points[8].x) / 2
  const y = (l.points[4].y + l.points[8].y) / 2
  if (!s.grab) s.grab = { x, y, yaw: control.view.yaw, pitch: control.view.pitch, size: l.size, zoom: control.view.zoom }
  control.view.yaw = s.grab.yaw + (x - s.grab.x) * GRAB_ROTATE_GAIN
  // «Схватил мир и потянул вниз» — дальний край мира опускается, смотрим сверху; вверх — сбоку.
  control.view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.grab.pitch + (y - s.grab.y) * GRAB_PITCH_GAIN))
  // Рука ближе к камере → ладонь крупнее → приближаем мир.
  const k = Math.pow(l.size / (s.grab.size || 1e-6), 1.6)
  control.view.zoom = Math.min(1.8, Math.max(0.6, s.grab.zoom * k))
}

/**
 * Меню: две раскрытые ладони ~0,8 с. Неважно, какую руку MediaPipe назвал левой или правой —
 * достаточно, что в кадре две руки и обе раскрыты (по нашим правилам или по встроенному жесту Open_Palm).
 */
function applyMenu(hands: (HandState | null)[], t: number) {
  const open = hands.filter((h) => h && !h.pinching && (h.openPalm || h.gesture === 'Open_Palm')).length
  if (open < 2) {
    s.pauseSince = 0
    s.pauseArmed = true
    control.menuHold = 0
    return
  }
  if (!s.pauseSince) s.pauseSince = t
  control.menuHold = s.pauseArmed ? Math.min(1, (t - s.pauseSince) / MENU_HOLD_MS) : 0
  if (s.pauseArmed && t - s.pauseSince > MENU_HOLD_MS) {
    control.pauseSeq++
    s.pauseArmed = false
    control.menuHold = 0
  }
}

function applyCursor(h: HandState | null) {
  if (!h) {
    control.cursor.visible = false
    return
  }
  // Кончик указательного; рабочая зона кадра растягивается на весь экран.
  const tip = h.points[8]
  control.cursor.x = Math.min(1, Math.max(0, (tip.x - 0.15) / 0.7))
  control.cursor.y = Math.min(1, Math.max(0, (tip.y - 0.1) / 0.65))
  control.cursor.visible = true
}

function processFace(res: ReturnType<FaceLandmarker['detectForVideo']>, t: number) {
  const lm = res.faceLandmarks[0]
  if (!lm) {
    control.head.visible = false
    control.face.points = []
    return
  }
  s.lastFaceAt = t
  const points = lm.map(mirror)
  const m = res.facialTransformationMatrixes?.[0]?.data
  const yaw = m ? yawFromMatrix(m) : 0
  const h = headFilter.filter(estimateHead(points, video!.videoWidth, video!.videoHeight, yaw), t)
  control.head.x = h.x
  control.head.y = h.y
  control.head.z = h.z
  control.head.yawDeg = yaw
  control.head.visible = true
  control.face.points = FACE_PREVIEW_POINTS.map((i) => points[i])
}

let brightnessCanvas: HTMLCanvasElement | null = null
function measureBrightness(v: HTMLVideoElement) {
  brightnessCanvas ??= Object.assign(document.createElement('canvas'), { width: 32, height: 24 })
  const ctx = brightnessCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  ctx.drawImage(v, 0, 0, 32, 24)
  const d = ctx.getImageData(0, 0, 32, 24).data
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  control.tracking.brightness = sum / (d.length / 4) / 255
}

function updateHints(t: number) {
  const phase = useGame.getState().phase
  const active = phase === 'playing' || phase === 'tutorial' || phase === 'countdown'
  const candidates = detectCandidates({
    left: control.hands.left,
    right: control.hands.right,
    head: control.head,
    brightness: control.tracking.brightness,
    joystickReach,
    scheme: control.scheme,
    noHandsMs: t - s.lastHandsAt,
    noFaceMs: t - s.lastFaceAt,
    onlyLeftMs: s.onlyLeftSince ? t - s.onlyLeftSince : 0,
    leftLostWhilePinchMs: s.leftLostWhilePinchAt ? t - s.leftLostWhilePinchAt : 0,
    wantsHands: active,
  })
  const { hints, appeared } = hintFilter.update(candidates, t)
  control.hints = hints
  if (phase === 'playing') for (const code of appeared) useGame.getState().countError(code)
}
