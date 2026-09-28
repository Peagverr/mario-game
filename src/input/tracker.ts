import { FaceLandmarker, FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { control, type HandState, type Point } from '../shared/controlState'
import { useGame } from '../shared/gameStore'
import { detectCandidates, HintFilter } from './errors'
import { HandTracker } from './gestures'
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

/** Рабочая зона джойстика в размерах ладони: сдвиг на столько = полный ход. */
const JOYSTICK_RANGE = 1.1
const JOYSTICK_DEADZONE = 0.2
/** Поворот мира: провести щипком через весь кадр = столько радиан. */
const GRAB_ROTATE_GAIN = Math.PI * 1.6
const PAUSE_HOLD_MS = 1000
const JUMP_COOLDOWN_MS = 250

let recognizer: GestureRecognizer | null = null
let face: FaceLandmarker | null = null
let video: HTMLVideoElement | null = null
let running = false

const trackers = { left: new HandTracker(), right: new HandTracker() }
const headFilter = new OneEuro3(1.0, 0.8)
const hintFilter = new HintFilter()

/** Внутреннее состояние жестов между кадрами. */
const s = {
  joyCenter: { x: 0.64, y: 0.62 },
  wasFist: false,
  lastJump: 0,
  grab: null as null | { x: number; yaw: number; size: number; zoom: number },
  pauseSince: 0,
  pauseArmed: true,
  lastHandsAt: 0,
  lastFaceAt: 0,
  onlyLeftSince: 0,
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
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
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
  const hands = recognizer.recognizeForVideo(video, t)
  const faceRes = face.detectForVideo(video, t)
  processHands(hands, t)
  processFace(faceRes, t)
  if (s.frame++ % 15 === 0) measureBrightness(video)
  updateHints(t)

  const dt = t - s.lastFrameAt
  s.lastFrameAt = t
  if (dt > 0 && dt < 1000) control.tracking.fps += (1000 / dt - control.tracking.fps) * 0.1
}

const mirror = (p: { x: number; y: number; z: number }): Point => ({ x: 1 - p.x, y: p.y, z: p.z })

function processHands(res: ReturnType<GestureRecognizer['recognizeForVideo']>, t: number) {
  const aspect = video!.videoWidth / video!.videoHeight
  const found: { side: 'left' | 'right'; points: Point[]; gesture: string }[] = []

  res.landmarks.forEach((lm, i) => {
    const points = lm.map(mirror)
    // MediaPipe считает, что кадр уже зеркальный; наш кадр — нет, поэтому метки перевёрнуты.
    const label = res.handedness[i]?.[0]?.categoryName
    const side: 'left' | 'right' = label === 'Left' ? 'right' : 'left'
    found.push({ side, points, gesture: res.gestures[i]?.[0]?.categoryName ?? 'None' })
  })
  // Если две руки получили одинаковую метку — решаем по положению: правее на экране = правая.
  if (found.length === 2 && found[0].side === found[1].side) {
    const [a, b] = found
    const aRight = a.points[0].x > b.points[0].x
    a.side = aRight ? 'right' : 'left'
    b.side = aRight ? 'left' : 'right'
  }

  const next: { left: HandState | null; right: HandState | null } = { left: null, right: null }
  for (const f of found) next[f.side] = trackers[f.side].update(f.points, f.gesture, aspect, t)
  if (!next.left) trackers.left.reset()
  if (!next.right) trackers.right.reset()
  control.hands.left = next.left
  control.hands.right = next.right
  if (next.left || next.right) s.lastHandsAt = t
  if (next.left && !next.right && next.left.openPalm) {
    if (!s.onlyLeftSince) s.onlyLeftSince = t
  } else s.onlyLeftSince = 0

  applyJoystick(next.right)
  applyJump(next.right, t)
  applyGrab(next.left)
  applyPause(next.left, next.right, t)
  applyCursor(next.right ?? next.left)
}

function shape(v: number) {
  const a = Math.abs(v)
  if (a < JOYSTICK_DEADZONE) return 0
  return Math.sign(v) * Math.min(1, (a - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE))
}

let joystickReach = 0
function applyJoystick(r: HandState | null) {
  if (!r) {
    control.move.x = 0
    control.move.y = 0
    joystickReach = 0
    return
  }
  const range = r.size * JOYSTICK_RANGE || 0.1
  const dx = (r.palm.x - s.joyCenter.x) / range
  const dy = (r.palm.y - s.joyCenter.y) / range
  joystickReach = Math.hypot(dx, dy)
  control.move.x = shape(dx)
  control.move.y = shape(-dy)
}

function applyJump(r: HandState | null, t: number) {
  const fist = !!r?.fist
  if (fist && !s.wasFist && t - s.lastJump > JUMP_COOLDOWN_MS) {
    control.jumpSeq++
    s.lastJump = t
    if (useGame.getState().phase === 'playing') useGame.getState().countJump()
  }
  s.wasFist = fist
}

function applyGrab(l: HandState | null) {
  const pinching = !!l?.pinching
  control.view.grabbing = pinching
  if (!l || !pinching) {
    s.grab = null
    return
  }
  const x = (l.points[4].x + l.points[8].x) / 2
  if (!s.grab) s.grab = { x, yaw: control.view.yaw, size: l.size, zoom: control.view.zoom }
  control.view.yaw = s.grab.yaw + (x - s.grab.x) * GRAB_ROTATE_GAIN
  // Рука ближе к камере → ладонь крупнее → приближаем мир.
  const k = Math.pow(l.size / (s.grab.size || 1e-6), 1.6)
  control.view.zoom = Math.min(1.8, Math.max(0.6, s.grab.zoom * k))
}

function applyPause(l: HandState | null, r: HandState | null, t: number) {
  const both = !!(l?.openPalm && r?.openPalm && !l.pinching)
  if (!both) {
    s.pauseSince = 0
    s.pauseArmed = true
    return
  }
  if (!s.pauseSince) s.pauseSince = t
  if (s.pauseArmed && t - s.pauseSince > PAUSE_HOLD_MS) {
    control.pauseSeq++
    s.pauseArmed = false
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
    noHandsMs: t - s.lastHandsAt,
    noFaceMs: t - s.lastFaceAt,
    onlyLeftMs: s.onlyLeftSince ? t - s.onlyLeftSince : 0,
    wantsHands: active,
  })
  const { hints, appeared } = hintFilter.update(candidates, t)
  control.hints = hints
  if (phase === 'playing') for (const code of appeared) useGame.getState().countError(code)
}
