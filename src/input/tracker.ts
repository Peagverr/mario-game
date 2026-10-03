import { FaceLandmarker, FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision'
import { control, type HandState, type Point } from '../shared/controlState'
import { useGame } from '../shared/gameStore'
import { detectCandidates, HintFilter } from './errors'
import { HandTracker } from './gestures'
import { estimateHead, FACE_PREVIEW_POINTS, yawFromMatrix } from './head'
import { OneEuro3 } from './oneEuro'
import { PalmJoystick, type FaceAnchor } from './palmJoystick'
import { HandConfirm, isFaceGhost, type FaceOval } from './ghostHands'
import { WorldGrab } from './worldGrab'

/**
 * Цикл распознавания: камера → MediaPipe (руки + лицо) → наши правила → `control`.
 * Весь код игры читает только `control` и ничего не знает о MediaPipe.
 */

const GESTURE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`

/**
 * MediaPipe в этой версии называет руки правильно для нашего (не отзеркаленного) кадра.
 * Если руки снова окажутся перепутаны — поменять на true.
 */
const SWAP_HANDEDNESS = false
/** Сколько мс держать мир, если левую руку на мгновение потеряли. */
const GRAB_LOST_GRACE_MS = 250
/** Рука дальше этого (в ширинах лица) по другую сторону от лица — значит, MediaPipe перепутал левую и правую. */
const HANDEDNESS_FACE_MARGIN = 0.6
/** Лицо старше этого (мс) не годится, чтобы ставить кольцо ладони. */
const FACE_FRESH_MS = 600
/** Две раскрытые ладони столько держать, чтобы открылось меню. */
const MENU_HOLD_MS = 800
const JUMP_COOLDOWN_MS = 250
/** Место и размер круга запоминаются в браузере: калибровка в обучении и кнопки в меню. */
const PALM_SETTINGS_KEY = 'okno.palm.v1'

let recognizer: GestureRecognizer | null = null
let face: FaceLandmarker | null = null
let video: HTMLVideoElement | null = null
let running = false

const trackers = { left: new HandTracker(), right: new HandTracker() }
/** Подтверждение новых рук (защита от призраков, см. ghostHands.ts). */
const confirm = { left: new HandConfirm(), right: new HandConfirm() }
// Голова: быстрее реагирует на движение (эффект окна не должен запаздывать), в покое всё ещё гладко.
const headFilter = new OneEuro3(1.6, 3)
// Лицо для кольца ладони: сглажено сильнее, чтобы кольцо в мини-окне не дрожало.
const faceAnchorFilter = new OneEuro3(1.2, 0.3)
const hintFilter = new HintFilter()
/** Ладонь у лица: кольцо-джойстик справа от лица (логика — в palmJoystick.ts). */
const palmJoy = new PalmJoystick()
/** Левый кулак держит мир: поворот, наклон и приближение (логика — в worldGrab.ts). */
const worldGrab = new WorldGrab()

/** Внутреннее состояние жестов между кадрами. */
const s = {
  /** Лицо в «квадратных» координатах (x·ширина/высота): центр между зрачками и ширина от скулы до скулы. */
  face: null as FaceAnchor | null,
  /** Сырой овал лица последнего кадра (без сглаживания — оно отстаёт от быстрой головы) и его скорость. */
  faceOval: null as FaceOval | null,
  faceSpeed: 0,
  faceOvalAt: 0,
  /** Первые шаги обучения: кольцо следует за ладонью, герой стоит. */
  calibrating: false,
  /** С какого момента правая рука видна, но ещё не заходила в круг (0 — зашла или руки нет). */
  palmUnarmedSince: 0,
  wasFist: false,
  lastJump: 0,
  /** Левый кулак держит мир и когда левую руку видели в последний раз. */
  grabbing: false,
  lastGrabAt: 0,
  pauseSince: 0,
  pauseArmed: true,
  lastHandsAt: 0,
  lastFaceAt: 0,
  onlyLeftSince: 0,
  /** Когда левая рука пропала посреди хвата кулаком (скорее всего, повернулась ребром к камере). */
  leftLostWhileGrabAt: 0,
  wasLeftGrabbing: false,
  frame: 0,
  lastFrameAt: 0,
  lastVideoTime: -1,
}

export type TrackerStatus = 'camera' | 'models' | 'ready'

/** Калибровка круга началась (обучение или «Поставить круг заново»): круг следует за ладонью, герой стоит. */
export function beginJoystickCalibration() {
  s.calibrating = true
}

/** Калибровку закончили или бросили: круг остаётся, где был. */
export function endJoystickCalibration() {
  s.calibrating = false
}

/** «Здесь удобно держать ладонь» — круг встанет туда относительно лица и запомнится. */
export function calibrateJoystick() {
  s.calibrating = false
  const r = control.hands.right
  const f = faceAnchor(performance.now())
  if (r && f) {
    palmJoy.calibrate(toSquare(r.palm), f)
    savePalmSettings()
  }
}

/** «Круг меньше / больше» из меню. Возвращает новый размер относительно обычного (1 = 100%). */
export function resizePalmRing(factor: number) {
  palmJoy.resize(factor)
  savePalmSettings()
  return palmJoy.ringScale
}

/** Размер круга относительно обычного (1 = 100%). */
export function palmRingScale() {
  return palmJoy.ringScale
}

function savePalmSettings() {
  const { offsetX, offsetY, dead, full } = palmJoy.params
  try {
    localStorage.setItem(PALM_SETTINGS_KEY, JSON.stringify({ offsetX, offsetY, dead, full }))
  } catch {
    // Хранилище недоступно — настройки просто не запомнятся.
  }
}

// Место и размер круга с прошлого раза (испорченные значения palmJoy.restore не примет).
try {
  const saved = JSON.parse(localStorage.getItem(PALM_SETTINGS_KEY) ?? 'null')
  if (saved && typeof saved === 'object') palmJoy.restore(saved)
} catch {
  // Нет сохранённого — круг по умолчанию.
}

function videoAspect() {
  return video && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3
}

/** Координаты кадра → «квадратные», где расстояния по x и y сравнимы. */
function toSquare(p: { x: number; y: number }) {
  return { x: p.x * videoAspect(), y: p.y }
}

/** Лицо, если его видно сейчас. */
function faceAnchor(t: number): FaceAnchor | null {
  return s.face && t - s.lastFaceAt < FACE_FRESH_MS ? s.face : null
}

async function createTasks() {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
  const make = async (delegate: 'GPU' | 'CPU') =>
    Promise.all([
      GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        // Новую руку — только уверенно (на 0.5 лицо при быстром движении головы находилось как ладонь),
        // а уже найденную держим на низких порогах, чтобы не терялась при повороте ребром к камере.
        minHandDetectionConfidence: 0.65,
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

  const oval = faceAnchor(t) ? s.faceOval : null
  res.landmarks.forEach((lm, i) => {
    const points = lm.map(mirror)
    // Рука-призрак на лице (MediaPipe путает лицо с ладонью при быстром движении головы) — пропускаем.
    if (isFaceGhost(points.map(toSquare), oval, s.faceSpeed)) return
    const world = (res.worldLandmarks[i] ?? []).map((p) => ({ x: -p.x, y: p.y, z: p.z }))
    const label = res.handedness[i]?.[0]?.categoryName
    const isRight = SWAP_HANDEDNESS ? label === 'Left' : label === 'Right'
    found.push({ side: isRight ? 'right' : 'left', points, world, gesture: res.gestures[i]?.[0]?.categoryName ?? 'None' })
  })
  // Левый кулак держит мир, правый — прыжок: путать руки нельзя. Если рука явно с другой стороны от лица,
  // чем её назвал MediaPipe (дальше HANDEDNESS_FACE_MARGIN ширин лица), верим положению, а не метке.
  const f = faceAnchor(t)
  if (f) {
    for (const h of found) {
      const dx = (h.points[0].x * aspect - f.x) / f.w
      if (h.side === 'right' && dx < -HANDEDNESS_FACE_MARGIN) h.side = 'left'
      else if (h.side === 'left' && dx > HANDEDNESS_FACE_MARGIN) h.side = 'right'
    }
  }
  // Если две руки получили одинаковую метку — решаем по положению: правее на экране = правая.
  if (found.length === 2 && found[0].side === found[1].side) {
    const [a, b] = found
    const aRight = a.points[0].x > b.points[0].x
    a.side = aRight ? 'right' : 'left'
    b.side = aRight ? 'left' : 'right'
  }

  // Новая рука засчитывается, только если её видно несколько кадров подряд: призраки мелькают на 1–2 кадра.
  for (const side of ['left', 'right'] as const) {
    const ok = confirm[side].update(found.some((h) => h.side === side))
    if (!ok) for (let i = found.length - 1; i >= 0; i--) if (found[i].side === side) found.splice(i, 1)
  }

  const next: { left: HandState | null; right: HandState | null } = { left: null, right: null }
  for (const f of found) next[f.side] = trackers[f.side].update(f.points, f.world, f.gesture, aspect, t)
  if (!next.left) trackers.left.reset()
  if (!next.right) trackers.right.reset()
  if (!next.left && s.wasLeftGrabbing) s.leftLostWhileGrabAt = t
  if (next.left) s.leftLostWhileGrabAt = 0
  s.wasLeftGrabbing = !!next.left?.fist
  control.hands.left = next.left
  control.hands.right = next.right
  if (next.left || next.right) s.lastHandsAt = t
  if (next.left && !next.right && next.left.openPalm) {
    if (!s.onlyLeftSince) s.onlyLeftSince = t
  } else s.onlyLeftSince = 0

  // Меню — раньше ходьбы: пока держишь две ладони (меню открывается), ладонь у лица не ведёт героя.
  applyMenu(found.length === 2 ? [next.left, next.right] : [], t)
  const phase = useGame.getState().phase
  const playable = phase === 'playing' || phase === 'tutorial' || phase === 'countdown'
  // «Поставить круг заново» идёт прямо в меню: там джойстик не выключаем, круг следует за ладонью.
  applyPalm(next.right, t, !playable && !s.calibrating, s.pauseSince > 0)
  applyJump(next.right, t)
  applyGrab(next.left, t)
  applyCursor(next.right ?? next.left)
}

/**
 * Ладонь у лица (идея Абзала): справа от лица — кольцо, его видно в мини-окне камеры.
 * Пока ладонь не побывала в центре — герой стоит; вышла из центра — идёт туда. Подробно — в palmJoystick.ts.
 * suspended — меню открыто или сейчас не игра; menuGesture — две ладони раскрыты, меню открывается.
 */
function applyPalm(r: HandState | null, t: number, suspended: boolean, menuGesture: boolean) {
  const st = palmJoy.update({
    t,
    palm: r ? toSquare(r.palm) : null,
    face: faceAnchor(t),
    suspended,
    calibrating: s.calibrating,
    holdStill: menuGesture,
  })
  control.move.x = st.move.x
  control.move.y = st.move.y
  const j = control.joystick
  const aspect = videoAspect()
  j.centerX = st.center.x / aspect
  j.centerY = st.center.y
  j.radius = st.full
  j.deadRadius = st.dead
  j.faceAnchored = st.faceAnchored
  j.armed = st.armed
  j.calibrating = s.calibrating && !suspended
  // В мини-окне кольцо прячем и в меню, и пока оно открывается.
  j.suspended = suspended || menuGesture
  j.sector = st.sector
  // Рука видна, а в круг не заходила — если так и держать, подскажем, куда её завести.
  if (r && !st.armed && !j.suspended && !s.calibrating) s.palmUnarmedSince ||= t
  else s.palmUnarmedSince = 0
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

/**
 * Левый кулак держит мир: сжал — схватил, повёл — мир крутится и наклоняется, к камере — приближается.
 * Раньше был щипок, но боком его камера не видит, а кулак распознаётся надёжно и держать его легче.
 */
function applyGrab(l: HandState | null, t: number) {
  // Руку на мгновение потеряли посреди хвата — не бросаем мир, ждём.
  if (!l && s.grabbing && t - s.lastGrabAt < GRAB_LOST_GRACE_MS) return
  const grabbing = !!l?.fist
  control.view.grabbing = grabbing
  if (!l || !grabbing) {
    s.grabbing = false
    control.view.mode = ''
    return
  }
  s.lastGrabAt = t
  // Центр ладони стабилен, когда кулак сжат (кончики пальцев прыгают).
  const p = { x: l.palm.x, y: l.palm.y, size: l.size }
  if (!s.grabbing) {
    const v = control.view
    worldGrab.start(p, { yaw: v.yaw, pitch: v.pitch, zoom: v.zoom }, videoAspect())
    s.grabbing = true
  }
  const v = worldGrab.move(p)
  control.view.yaw = v.yaw
  control.view.pitch = v.pitch
  control.view.zoom = v.zoom
  control.view.mode = worldGrab.axis ?? ''
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
  // Кольцо ладони привязано к лицу: центр — между зрачками, ширина — от скулы до скулы (точки 234 и 454).
  const aspect = videoAspect()
  const f = faceAnchorFilter.filter(
    {
      x: ((points[468].x + points[473].x) / 2) * aspect,
      y: (points[468].y + points[473].y) / 2,
      z: Math.abs(points[454].x - points[234].x) * aspect,
    },
    t,
  )
  s.face = { x: f.x, y: f.y, w: f.z }
  // Сырой овал лица (скулы 234/454, лоб 10, подбородок 152) — для отбраковки рук-призраков.
  const oval: FaceOval = {
    cx: ((points[234].x + points[454].x) / 2) * aspect,
    cy: (points[10].y + points[152].y) / 2,
    rx: (Math.abs(points[454].x - points[234].x) / 2) * aspect * 1.05,
    ry: (Math.abs(points[152].y - points[10].y) / 2) * 1.1,
  }
  const prev = s.faceOval
  const dtFace = t - s.faceOvalAt
  if (prev && dtFace > 0 && dtFace < 300) {
    const speed = Math.hypot(oval.cx - prev.cx, oval.cy - prev.cy) / (oval.rx * 2) / (dtFace / 1000)
    s.faceSpeed += (speed - s.faceSpeed) * 0.5
  }
  s.faceOval = oval
  s.faceOvalAt = t
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
    noHandsMs: t - s.lastHandsAt,
    noFaceMs: t - s.lastFaceAt,
    onlyLeftMs: s.onlyLeftSince ? t - s.onlyLeftSince : 0,
    leftLostWhileGrabMs: s.leftLostWhileGrabAt ? t - s.leftLostWhileGrabAt : 0,
    palmUnarmedMs: s.palmUnarmedSince ? t - s.palmUnarmedSince : 0,
    wantsHands: active,
    inTutorial: phase === 'tutorial',
  })
  const { hints, appeared } = hintFilter.update(candidates, t)
  control.hints = hints
  if (phase === 'playing') for (const code of appeared) useGame.getState().countError(code)
}
