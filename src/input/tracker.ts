import { FaceLandmarker, FilesetResolver, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision'
import { control, type CameraStatus, type HandState, type Point } from '../shared/controlState'
import { useGame } from '../shared/gameStore'
import { BLACK_FRAME, detectCandidates, HintFilter } from './errors'
import { HandTracker } from './gestures'
import { armsFromPose, HandIdentity, type ArmRef, type HandSeen } from './handIdentity'
import { estimateHead, FACE_PREVIEW_POINTS, yawFromMatrix } from './head'
import { OneEuro3 } from './oneEuro'
import { PalmJoystick, type FaceAnchor } from './palmJoystick'
import { HandConfirm, HOLD_MS, isFaceGhost, nearFace, type FaceOval } from './ghostHands'
import { handScale, WorldGrab } from './worldGrab'

/**
 * Цикл распознавания: камера → MediaPipe (руки + лицо) → наши правила → `control`.
 * Весь код игры читает только `control` и ничего не знает о MediaPipe.
 */

const GESTURE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
/** Поза тела (плечи, локти, запястья): по ней понятно, на какой руке тела кулак (handIdentity.ts). */
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`
/** Позу считаем, когда в кадре новая рука, и раз в столько мс — чтобы проверять уже узнанные руки. */
const POSE_PERIOD_MS = 200
/** Поза старше этого (мс) уже не годится: руки успели уехать. */
const POSE_FRESH_MS = 250

/**
 * MediaPipe в этой версии называет руки правильно для нашего (не отзеркаленного) кадра.
 * Если руки снова окажутся перепутаны — поменять на true.
 */
const SWAP_HANDEDNESS = false
/** Сколько мс держать мир, если левую руку на мгновение потеряли. */
const GRAB_LOST_GRACE_MS = 250
/** Новых кадров с камеры нет дольше этого (мс) — камера замерла: руки отпускаем, герой стоит. */
const FROZEN_MS = 1000
/** Камера отключена или стоит дольше этого (мс) — пробуем подключить её заново, не чаще раза в RECONNECT_EVERY_MS. */
const RECONNECT_AFTER_MS = 3000
const RECONNECT_EVERY_MS = 3000
/** Цикл не крутился дольше этого (мс) — вкладка была в фоне; это не «камера замерла». */
const LOOP_GAP_MS = 500
/** Рука на другой стороне ближе этого (доли кадра) к пропавшей — это она же, просто сменила сторону. */
const RENAMED_DIST = 0.08
/** Лицо старше этого (мс) не годится, чтобы ставить кольцо ладони. */
const FACE_FRESH_MS = 600
/** Две раскрытые ладони столько держать, чтобы открылось меню. */
const MENU_HOLD_MS = 800
const JUMP_COOLDOWN_MS = 250
/** Место и размер круга запоминаются в браузере: калибровка в обучении и кнопки в меню. */
const PALM_SETTINGS_KEY = 'okno.palm.v1'
/** Чувствительность левого кулака (меню «Поворот мира»). */
const GRAB_SETTINGS_KEY = 'okno.grab.v1'
const GRAB_SPEED_LIMITS = [0.5, 2] as const
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  // 60 кадров/с, если камера умеет: выдержка короче — быстрая рука меньше смазывается и не теряется.
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 60 },
  facingMode: 'user',
}

let recognizer: GestureRecognizer | null = null
let face: FaceLandmarker | null = null
/** Грузится в фоне после старта: пока её нет, руки узнаются без позы. */
let pose: PoseLandmarker | null = null
let video: HTMLVideoElement | null = null
let stream: MediaStream | null = null
let running = false

const trackers = { left: new HandTracker(), right: new HandTracker() }
/** Какая рука левая, а какая правая — с памятью между кадрами (handIdentity.ts). */
const identity = new HandIdentity()
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
  /** Когда каждую руку видели последний раз (для удержания при коротком пропадании). */
  handSeenAt: { left: 0, right: 0 },
  lastFaceAt: 0,
  onlyLeftSince: 0,
  /** Когда левая рука пропала посреди хвата кулаком (скорее всего, повернулась ребром к камере). */
  leftLostWhileGrabAt: 0,
  wasLeftGrabbing: false,
  frame: 0,
  lastFrameAt: 0,
  lastVideoTime: -1,
  /** Когда пришёл последний новый кадр с камеры и когда последний раз крутился цикл. */
  lastNewFrameAt: 0,
  lastLoopAt: 0,
  /** Камеру отключили (дорожка видео закончилась) — ждём, пока подключится снова. */
  cameraEnded: false,
  reconnecting: false,
  lastReconnectAt: 0,
  /** Запястья по позе тела и когда их посчитали. */
  arms: null as ArmRef | null,
  armsAt: 0,
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

/** «Поворот мира медленнее / быстрее» из меню. Возвращает новую чувствительность (1 = 100%). */
export function scaleGrabSpeed(factor: number) {
  const [lo, hi] = GRAB_SPEED_LIMITS
  worldGrab.speed = Math.min(hi, Math.max(lo, worldGrab.speed * factor))
  try {
    localStorage.setItem(GRAB_SETTINGS_KEY, JSON.stringify({ speed: worldGrab.speed }))
  } catch {
    // Хранилище недоступно — настройка просто не запомнится.
  }
  return worldGrab.speed
}

/** Чувствительность левого кулака (1 = 100%). */
export function grabSpeed() {
  return worldGrab.speed
}

// Чувствительность кулака с прошлого раза.
try {
  const saved = JSON.parse(localStorage.getItem(GRAB_SETTINGS_KEY) ?? 'null')
  const speed = Number(saved?.speed)
  if (speed >= GRAB_SPEED_LIMITS[0] && speed <= GRAB_SPEED_LIMITS[1]) worldGrab.speed = speed
} catch {
  // Нет сохранённого — обычная чувствительность.
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
        // Чуть выше стандартных 0.5 (лицо при быстром движении головы находилось как ладонь — его отсекает
        // ghostHands.ts), но не выше: иначе смазанная при рывке рука находится заново слишком поздно.
        minHandDetectionConfidence: 0.55,
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
    const tasks = await make('GPU')
    void createPose(vision, 'GPU')
    return tasks
  } catch (e) {
    console.warn('[tracker] GPU недоступен, переключаюсь на CPU', e)
    const tasks = await make('CPU')
    void createPose(vision, 'CPU')
    return tasks
  }
}

/** Поза — в фоне, после старта: игра не ждёт лишние 6 МБ. Не загрузилась — руки узнаются без неё. */
async function createPose(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: 'GPU' | 'CPU') {
  try {
    pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
  } catch (e) {
    console.warn('[tracker] поза тела не загрузилась — руки узнаются без неё', e)
  }
}

/** Для отладки (?debug): загружена ли поза и какие запястья тела она видит. */
export function poseDebug() {
  if (!pose) return 'поза —'
  const a = performance.now() - s.armsAt < 1000 ? s.arms : null
  if (!a) return 'поза: нет плеч'
  return `поза: Л${a.left ? '✓' : '—'} П${a.right ? '✓' : '—'}`
}

/** Посчитать позу на этом кадре. */
function updateArms(t: number) {
  if (!pose || !video) return
  try {
    s.arms = armsFromPose(pose.detectForVideo(video, t).landmarks[0], videoAspect())
    s.armsAt = t
  } catch (e) {
    console.warn('[tracker] поза тела: ошибка, выключаю', e)
    pose = null
  }
}

export async function startTracking(onStatus: (s: TrackerStatus) => void) {
  if (running) return
  onStatus('camera')
  stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false })
  watchStream(stream)
  video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  control.tracking.video = video
  // Подключили или отключили камеру в системе — если наша не работает, пробуем сразу, не ждём таймера.
  navigator.mediaDevices.addEventListener?.('devicechange', () => {
    if (control.tracking.camera === 'ended' || control.tracking.camera === 'frozen') void reconnectCamera()
  })

  onStatus('models')
  ;[recognizer, face] = await createTasks()

  running = true
  control.tracking.ready = true
  s.lastNewFrameAt = s.lastLoopAt = performance.now()
  onStatus('ready')
  requestAnimationFrame(loop)
}

/** Камеру отключили (кнопка на ноутбуке, драйвер, кабель) — дорожка видео заканчивается. */
function watchStream(st: MediaStream) {
  for (const track of st.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (stream === st) s.cameraEnded = true
    })
  }
}

/** Подключить камеру заново. Разрешение уже дано — браузер не спрашивает ещё раз. */
async function reconnectCamera() {
  if (s.reconnecting || !video) return
  s.reconnecting = true
  s.lastReconnectAt = performance.now()
  try {
    const next = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false })
    const old = stream
    stream = next
    watchStream(next)
    video.srcObject = next
    await video.play()
    old?.getTracks().forEach((tr) => tr.stop())
    s.cameraEnded = false
    s.lastVideoTime = -1
  } catch (e) {
    // Камера всё ещё занята или выключена — попробуем позже.
    console.warn('[tracker] камера пока не подключается', e)
  } finally {
    s.reconnecting = false
    s.lastReconnectAt = performance.now()
  }
}

/** Пустой результат распознавания: «рук не видно» — через него руки отпускаются как обычно (герой встаёт, мир отпускается). */
const NO_HANDS = { landmarks: [], worldLandmarks: [], handedness: [], gestures: [] } as unknown as ReturnType<GestureRecognizer['recognizeForVideo']>

function cameraStatus(t: number): CameraStatus {
  if (s.cameraEnded) return 'ended'
  if (t - s.lastNewFrameAt > FROZEN_MS) return 'frozen'
  if (control.tracking.brightness < BLACK_FRAME) return 'black'
  return 'ok'
}

function loop() {
  if (!running || !video || !recognizer || !face) return
  requestAnimationFrame(loop)
  const t = performance.now()
  // Вкладка была в фоне — цикл стоял, а не камера.
  if (t - s.lastLoopAt > LOOP_GAP_MS) s.lastNewFrameAt = t
  s.lastLoopAt = t

  if (video.readyState < 2 || video.currentTime === s.lastVideoTime) {
    // Новых кадров нет. Если долго — камера замерла: руки и лицо отпускаем, подсказываем, переподключаемся.
    const cam = cameraStatus(t)
    control.tracking.camera = cam
    if (cam === 'frozen' || cam === 'ended') {
      processHands(NO_HANDS, t)
      control.head.visible = false
      control.face.points = []
      updateHints(t)
      if (t - s.lastNewFrameAt > RECONNECT_AFTER_MS || cam === 'ended') {
        if (t - s.lastReconnectAt > RECONNECT_EVERY_MS) void reconnectCamera()
      }
    }
    return
  }
  s.lastVideoTime = video.currentTime
  s.lastNewFrameAt = t

  const t0 = performance.now()
  const hands = recognizer.recognizeForVideo(video, t)
  processHands(hands, t)
  // Лицо — через кадр: голова движется плавно, а руки важнее для отклика. Экономит ~40% времени распознавания.
  if (s.frame % 2 === 0) processFace(face.detectForVideo(video, t), t)
  control.tracking.inferMs += (performance.now() - t0 - control.tracking.inferMs) * 0.1
  if (s.frame++ % 15 === 0) measureBrightness(video)
  control.tracking.camera = cameraStatus(t)
  updateHints(t)

  const dt = t - s.lastFrameAt
  s.lastFrameAt = t
  if (dt > 0 && dt < 1000) control.tracking.fps += (1000 / dt - control.tracking.fps) * 0.1
}

const mirror = (p: { x: number; y: number; z: number }): Point => ({ x: 1 - p.x, y: p.y, z: p.z })
/** Центр ладони: запястье и основания пальцев (кончики при сжатии кулака прыгают). */
const PALM_POINTS = [0, 5, 9, 13, 17]

function processHands(res: ReturnType<GestureRecognizer['recognizeForVideo']>, t: number) {
  const aspect = videoAspect()
  const found: { side: 'left' | 'right'; points: Point[]; world: Point[]; gesture: string; nearFace: boolean }[] = []

  const oval = faceAnchor(t) ? s.faceOval : null
  const seen: HandSeen[] = []
  res.landmarks.forEach((lm, i) => {
    const points = lm.map(mirror)
    // Рука-призрак на лице (MediaPipe путает лицо с ладонью при быстром движении головы) — пропускаем.
    const sq = points.map(toSquare)
    if (isFaceGhost(sq, oval, s.faceSpeed)) return
    const world = (res.worldLandmarks[i] ?? []).map((p) => ({ x: -p.x, y: p.y, z: p.z }))
    const hd = res.handedness[i]?.[0]
    const label = hd?.categoryName === 'Right' || hd?.categoryName === 'Left' ? hd.categoryName : null
    const isRight = SWAP_HANDEDNESS ? label === 'Left' : label === 'Right'
    const gesture = res.gestures[i]?.[0]?.categoryName ?? 'None'
    const palm = PALM_POINTS.reduce((a, j) => ({ x: a.x + sq[j].x / PALM_POINTS.length, y: a.y + sq[j].y / PALM_POINTS.length }), { x: 0, y: 0 })
    seen.push({
      ...palm,
      wrist: sq[0],
      size: Math.hypot(sq[9].x - sq[0].x, sq[9].y - sq[0].y),
      label: label ? (isRight ? 'right' : 'left') : null,
      score: hd?.score ?? 0.5,
      fist: gesture === 'Closed_Fist',
    })
    found.push({ side: 'left', points, world, gesture, nearFace: nearFace(sq, oval) })
  })
  // Левый кулак держит мир, правый — прыжок: путать руки нельзя. Сторону решаем, когда рука появилась,
  // и дальше узнаём руку по непрерывному движению (handIdentity.ts) — где она относительно головы, уже не важно.
  // Поза тела (на какой руке тела кулак): считать её дорого (~как руки), поэтому — только в кадры без лица
  // (лицо считается в чётные), когда рука новая, и раз в POSE_PERIOD_MS для проверки уже узнанных рук.
  const poseFrame = s.frame % 2 === 1
  if (seen.length && poseFrame && (identity.needsArms(seen, t) || t - s.armsAt > POSE_PERIOD_MS)) updateArms(t)
  const arms = t - s.armsAt < POSE_FRESH_MS ? s.arms : null
  const sides = identity.assign(seen, t, faceAnchor(t), aspect, arms)
  for (let i = found.length - 1; i >= 0; i--) {
    const side = sides[i]
    if (side) found[i].side = side
    else found.splice(i, 1)
  }

  // Новая рука у лица засчитывается, только если её видно несколько кадров подряд: призраки мелькают на 1–2 кадра.
  for (const side of ['left', 'right'] as const) {
    const h = found.find((x) => x.side === side)
    const ok = confirm[side].update(!!h, !!h?.nearFace)
    if (!ok) for (let i = found.length - 1; i >= 0; i--) if (found[i].side === side) found.splice(i, 1)
  }

  const next: { left: HandState | null; right: HandState | null } = { left: null, right: null }
  for (const f of found) next[f.side] = trackers[f.side].update(f.points, f.world, f.gesture, aspect, t)
  // Рука пропала на долю секунды (смазалась при рывке) — держим последнее положение, управление не обрывается.
  // Но если она не пропала, а сменила сторону (handIdentity поправил ошибку), старую копию не держим.
  let renamed = false
  for (const side of ['left', 'right'] as const) {
    const prev = control.hands[side]
    const now = next[side === 'left' ? 'right' : 'left']
    const moved = !next[side] && prev && now && Math.hypot(now.palm.x - prev.palm.x, now.palm.y - prev.palm.y) < RENAMED_DIST
    if (moved) renamed = true
    if (next[side]) s.handSeenAt[side] = t
    else if (prev && !moved && t - s.handSeenAt[side] < HOLD_MS) next[side] = prev
    else trackers[side].reset()
  }
  if (!next.left && s.wasLeftGrabbing && !renamed) s.leftLostWhileGrabAt = t
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
    control.view.edge = 0
    control.view.rate = 0
    return
  }
  s.lastGrabAt = t
  // Центр ладони стабилен, когда кулак сжат (кончики пальцев прыгают). Масштаб — по костям ладони, а не по одной.
  const aspect = videoAspect()
  const p = { x: l.palm.x, y: l.palm.y, scale: handScale(l.points, l.world, aspect) }
  if (!s.grabbing) {
    const v = control.view
    worldGrab.start(p, { yaw: v.yaw, pitch: v.pitch, zoom: v.zoom }, aspect, t)
    s.grabbing = true
  }
  const v = worldGrab.move(p, t)
  control.view.yaw = v.yaw
  control.view.pitch = v.pitch
  control.view.zoom = v.zoom
  control.view.mode = worldGrab.axis ?? ''
  const z = worldGrab.zone
  control.view.anchorX = z.x
  control.view.anchorY = z.y
  control.view.edge = z.edge
  control.view.rate = z.rate
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
    camera: control.tracking.camera,
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
