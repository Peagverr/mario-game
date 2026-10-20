import { create } from 'zustand'
import type { HintCode } from './shared/controlState'

/**
 * Языки интерфейса: английский (по умолчанию) и русский.
 * Словари ниже с одинаковыми ключами: если в одном языке строки нет, проект не соберётся.
 * Выбор хранится в localStorage; ссылка ?lang=ru или ?lang=en его перебивает.
 * В React — useT() (перерисует экран при смене языка), в остальном коде — t().
 */

export type Lang = 'en' | 'ru'

type Advice = Record<HintCode, { title: string; tip: string }>
type LevelId = 'level1' | 'level2' | 'level3'
type StepId = 'palm' | 'move' | 'jump' | 'grab' | 'head' | 'menu'

/** «1 раз», «2 раза», «5 раз». */
function ruTimes(n: number) {
  const d = n % 10
  const dd = n % 100
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'раза' : 'раз'
}

const en = {
  name: 'Window',
  docTitle: 'Window, a game you control with your webcam',
  start: {
    eyebrow: 'Webcam game, no controller',
    lead: 'The screen turns into a window onto a small floating world. Move your head to look inside. Walk with your right palm in the joystick circle and make a fist to jump. The left fist turns the world.',
    play: 'Turn on camera and play',
    privacy: 'The camera video is processed in your browser and never leaves your computer. This is the only click: after it you play with your hands and head.',
    loadingCamera: 'Turning on the camera. Allow access in the browser window...',
    loadingModels: 'Loading the recognition models (about 18 MB, only once)...',
    ready: 'Ready!',
    retry: 'Try again',
    dev: '[dev] no camera, keyboard',
    errInsecure: 'The camera only works over a secure link (https). Open the game from the link in the README.',
    errDenied: 'Camera access is blocked. Click the camera icon in the address bar, choose Allow and reload the page.',
    errNotFound: 'No camera found. Plug in a webcam or open the game on a laptop with a camera.',
    errBusy: 'Another app is using the camera (Zoom, Telegram, OBS). Close it and try again.',
    errModels: 'Could not load the recognition models. Check your internet connection and reload the page.',
    /** Жирная часть и продолжение. */
    how: [
      ['Move your head', ' to look around'],
      ['Right palm in the circle', ' to walk'],
      ['Fist', ' to jump'],
      ['Left fist', ' to turn and zoom the world'],
      ['Two palms', ' to pause'],
    ] as [string, string][],
  },
  tutorial: {
    steps: {
      palm: {
        title: 'Put your palm in the circle',
        text: 'Raise your right palm and a red dot appears on the joystick at the bottom right. Move it into the yellow center and hold it there. It is easier with your hand low, and you can rest your elbow on the table.',
      },
      move: {
        title: 'Move your palm off center',
        text: 'Palm in the center: you stand still. Move it up to go forward, down to go back, left or right to step sideways. Bring it back to the center to stop.',
      },
      jump: {
        title: 'Make a fist',
        text: 'A right fist is a jump. Open your hand and close it again to jump once more.',
      },
      grab: {
        title: 'Make a left fist',
        text: 'Your left fist holds the world. Move it anywhere and the world turns and tilts. Take it past the teal circle and the world keeps turning on its own. Move the fist toward the camera or away from it to zoom. Open your hand to let go.',
      },
      head: {
        title: 'Move your head',
        text: 'Left and right, up and down. The screen is a window, so you can look into the world from the side.',
      },
      menu: {
        title: 'Two palms open the menu',
        text: 'Open both palms and hold for a second. The menu opens: pause, restart, lobby, and the size and place of the circle.',
      },
    } as Record<StepId, { title: string; text: string }>,
    step: (n: number, of: number) => `Step ${n} of ${of}`,
    done: "Great! Let's go",
    skip: 'Skip the tutorial: point here with your left hand',
  },
  hud: {
    go: 'Go!',
    lobby: 'Lobby. Walk into a portal to start a level',
    secret: 'secret',
    holding: 'holding the world',
    legend: [
      'palm in the circle to get ready',
      'move the palm to walk',
      'fist to jump',
      'left fist to turn, tilt or zoom',
      'two palms for the menu',
    ],
    menuHold: 'Menu...',
  },
  menu: {
    title: 'Menu',
    lead: 'Point a finger at a button and hold for a second.',
    resume: 'Continue',
    restart: 'Restart',
    lobby: 'Lobby',
    grab: (pct: number) => `Left fist turn speed: ${pct}%`,
    slower: 'Slower',
    faster: 'Faster',
    ring: (pct: number) => `Joystick circle: ${pct}%`,
    smaller: 'Smaller',
    bigger: 'Bigger',
    place: 'Place it again',
    langTitle: 'Language',
    /** Кнопка в меню: на какой язык переключиться. */
    otherLang: 'Русский',
    setupTitle: 'Place the circle',
    setupLead: 'Raise your right palm where it feels comfortable (low on the right works best) and hold it for a second.',
    setupFine: 'In the camera window at the bottom left, the yellow circle follows your palm for now.',
  },
  cam: {
    rightNone: 'Right: not seen',
    leftNone: 'Left: not seen',
    leftSeen: 'Left: visible',
    rightSeen: 'Right: visible',
    rightFist: 'Right: fist, jump',
    rightCalibrating: 'Right: hold still, placing the circle',
    rightArm: 'Right: move into the yellow circle',
    rightBack: 'Right: back to the circle',
    /** Секторы: 0 вправо, 1 вперёд, 2 влево, 3 назад. */
    rightWalk: ['Right: walking right', 'Right: walking forward', 'Right: walking left', 'Right: walking back'],
    rightStop: 'Right: stop',
    leftZoom: (zoom: string) => `Left: zoom ${zoom}x`,
    leftSpin: 'Left: world turns by itself',
    leftHold: 'Left: holding the world',
    leftFist: 'Left: fist, move or push',
    fps: (n: number) => `camera ${n} fps`,
  },
  /** Строка замеров под окном камеры (только с ?debug). */
  debug: {
    left: (fist: boolean) => `left ${fist ? 'fist ✓' : 'open'}`,
    leftNone: 'left -',
    fingers: (marks: string) => `fingers ${marks}`,
    head: (x: string, y: string, z: string) => `head x${x} y${y} z${z} cm`,
    faceNone: 'face -',
    infer: (ms: string) => `inference ${ms} ms`,
    render: (fps: number, sharp: number, eco: boolean) => `render ${fps} fps · sharpness ${sharp}%${eco ? ' · eco' : ''}`,
    poseNone: 'pose -',
    poseNoArms: 'pose: no shoulders',
    pose: (left: boolean, right: boolean) => `pose: L${left ? '✓' : '-'} R${right ? '✓' : '-'}`,
  },
  pad: {
    walk: ['Walking right', 'Walking forward', 'Walking left', 'Walking back'],
    raise: 'Raise your palm',
    jump: 'Jump',
    center: 'Palm to the center',
    back: 'Back to the center',
    stop: 'Stop',
  },
  lost: {
    black: 'The camera shows a black frame. Open the camera shutter or close the app that is using it.',
    frozen: 'The camera stopped sending video. Check that it is on and no other app is using it.',
    ended: 'The camera was disconnected. Turn it back on with the laptop key or in settings, and the game will reconnect by itself.',
    backTitle: 'I see you again',
    backCount: (n: number) => `Continuing in ${n}...`,
    backNow: 'Continuing now...',
    title: 'No picture from the camera',
    paused: 'The game and the timer are paused. Once the camera works again, you continue from the same spot.',
  },
  hints: {
    fingers: ['thumb', 'index', 'middle', 'ring', 'pinky'],
    rightHand: 'Your right hand',
    leftHand: 'Your left hand',
    edgeLeft: (who: string) => `${who} is leaving the left edge of the frame. Move it to the right`,
    edgeRight: (who: string) => `${who} is leaving the right edge of the frame. Move it to the left`,
    edgeLow: (who: string) => `${who} is too low. Raise it to the middle of the frame`,
    edgeHigh: (who: string) => `${who} is too high. Lower it a little`,
    cameraLost: 'The camera stopped sending video. Check that it is on and no other app is using it. The game will reconnect by itself',
    cameraBlocked: 'The camera shows a black frame. Open the camera shutter or close the app that is using it',
    dark: 'Too dark. Turn on a light or face a window',
    noFace: "I can't see your face. Sit straight in front of the camera",
    tooClose: (cm: number) => `Too close to the screen. Sit back about ${cm} cm`,
    tooFar: (cm: number) => `Too far from the camera. Come about ${cm} cm closer`,
    headTurned: 'Your head is turned away. Keep your face toward the screen while you move',
    noHands: 'Raise your right palm and a red dot appears. Bring it into the yellow center of the joystick at the bottom right',
    handTurned: 'The camera lost your left hand. Turn the knuckles of your fist toward the camera',
    wrongHand: 'Walk with your right hand. Make a left fist to turn the world',
    fistPartial: (fingers: string[]) => `To jump, close your fist all the way. Not bent: ${fingers.join(', ')}`,
    palmNotArmed: 'Move the red dot (your right palm) into the yellow center of the joystick at the bottom right. Then the hero will walk',
  },
  advice: {
    'camera-blocked': { title: 'Camera blocked', tip: 'Open the camera shutter and check that no other app is using it.' },
    'camera-lost': { title: 'Camera dropped out', tip: "Check that the laptop's camera key is not turning it off and that no other app is using it." },
    'fist-partial': { title: 'Partial fist', tip: 'Curl all four fingers at once, as if you were grabbing a handle.' },
    'hand-edge': { title: 'Hand at the frame edge', tip: 'Keep your hands closer to your chest, in the middle of the frame.' },
    'palm-not-armed': { title: 'Palm outside the circle', tip: 'First move the red dot (your palm) into the yellow center of the joystick at the bottom right.' },
    'wrong-hand': { title: 'Wrong hand', tip: 'Your right hand walks and jumps. Your left hand turns the world.' },
    'no-hands': { title: 'Hands out of frame', tip: 'Keep your right palm low on the right, inside the joystick circle.' },
    'no-face': { title: 'Face out of frame', tip: 'Sit facing the camera so the window effect works.' },
    'too-close': { title: 'Too close', tip: 'The best distance is 50 to 70 cm from the screen.' },
    'too-far': { title: 'Too far', tip: 'The best distance is 50 to 70 cm from the screen.' },
    'head-turned': { title: 'Head turned', tip: 'Keep your face toward the screen while you move your head.' },
    dark: { title: 'Not enough light', tip: 'Put the light in front of you so it falls on your face and hands.' },
    'hand-turned': { title: 'Left hand lost', tip: "Hold your fist with the knuckles toward the camera. From the side the camera can't see it." },
  } as Advice,
  results: {
    complete: (level: string) => `Level "${level}" complete`,
    points: (n: number) => `${n} points`,
    stars: 'stars',
    time: 'time',
    sec: 's',
    accuracy: 'gesture accuracy',
    falls: 'falls',
    review: 'Mistake review',
    clean: 'Not a single gesture mistake.',
    /** После названия ошибки: «: 3 times». */
    count: (n: number) => `: ${n} ${n === 1 ? 'time' : 'times'}`,
    records: 'High scores',
    you: ' (you)',
    missed: (name: string) => `You are ${name}. You just missed the table.`,
    next: (level: string) => `Next: ${level}`,
    again: 'Play again',
    lobby: 'Lobby',
  },
  names: {
    adj: ['Brave', 'Quick', 'Nimble', 'Sly', 'Cheerful', 'Keen-eyed', 'Bouncy', 'Quiet'],
    noun: ['Fox', 'Snow Leopard', 'Hedgehog', 'Owl', 'Cat', 'Falcon', 'Wolf', 'Raccoon'],
  },
  levels: {
    level1: { title: 'Islands', feature: 'walk and jump' },
    level2: { title: 'Peek', feature: 'move your head' },
    level3: { title: 'Turn the World', feature: 'left fist' },
  } as Record<LevelId, { title: string; feature: string }>,
  lobby: {
    soon: 'soon',
    best: (score: number) => `best ${score}`,
  },
  level2: {
    line1: 'Secret stars are hidden in the yards behind the walls.',
    line2: "Raise your head to look over a wall, or make a left fist and pull the world down. Once you see a star, it's yours!",
    gate: (found: number, total: number) => `Find the secret stars to open the gate: ${found}/${total}`,
  },
  level3: {
    line1: 'The bridges come together only at the right angle.',
    line2: 'Make a left fist and move it to the side. The planks will slide into a bridge.',
    bridgeOk: 'Bridge ready. Go!',
    bridgeRight: 'Turn the World: left fist, move it right',
    bridgeLeft: 'Turn the World: left fist, move it left',
  },
}

export type Dict = typeof en

const ru: Dict = {
  name: 'Окно',
  docTitle: 'Окно — игра, которой управляют камерой',
  start: {
    eyebrow: 'Admit Hackathon · кейс Motion',
    lead: 'Экран станет окном в маленький парящий мир. Двигай головой — заглядывай внутрь. Правой ладонью в круге-джойстике веди героя, кулаком — прыгай, левым кулаком — поворачивай мир.',
    play: 'Включить камеру и играть',
    privacy: 'Видео с камеры обрабатывается прямо в браузере и никуда не отправляется. Это единственный клик — дальше всё управляется руками и головой.',
    loadingCamera: 'Включаем камеру — разреши доступ в окне браузера…',
    loadingModels: 'Загружаем нейросети распознавания (~18 МБ, один раз)…',
    ready: 'Готово!',
    retry: 'Попробовать снова',
    dev: '[dev] без камеры — клавиатура',
    errInsecure: 'Камера работает только по защищённой ссылке (https). Открой игру по ссылке из README.',
    errDenied: 'Доступ к камере запрещён. Нажми на значок камеры в адресной строке → «Разрешить» и обнови страницу.',
    errNotFound: 'Камера не найдена. Подключи веб-камеру или открой игру на ноутбуке с камерой.',
    errBusy: 'Камера занята другой программой (Zoom, Telegram, OBS). Закрой её и попробуй снова.',
    errModels: 'Не удалось загрузить нейросети распознавания. Проверь интернет и обнови страницу.',
    how: [
      ['Голова', ' — эффект окна'],
      ['Правая ладонь в круге', ' — ходьба'],
      ['Кулак', ' — прыжок'],
      ['Левый кулак', ' — повернуть и приблизить мир'],
      ['Две ладони', ' — пауза'],
    ],
  },
  tutorial: {
    steps: {
      palm: {
        title: 'Заведи ладонь в круг',
        text: 'Подними правую ладонь — на джойстике справа внизу появится красная точка. Заведи её в жёлтый центр и задержи. Руку удобно держать низко, локоть можно опереть на стол.',
      },
      move: {
        title: 'Сдвинь ладонь из центра',
        text: 'Ладонь в центре — стоишь. Сдвинь её: вверх — вперёд, вниз — назад, в стороны — вбок. Вернул в центр — стоп.',
      },
      jump: {
        title: 'Сожми кулак',
        text: 'Кулак правой руки — прыжок. Разожми и сожми снова, чтобы прыгнуть ещё раз.',
      },
      grab: {
        title: 'Сожми левый кулак',
        text: 'Левый кулак держит мир: веди его куда угодно — мир крутится и наклоняется. Уведи дальше бирюзового круга — мир будет крутиться сам. Кулак к камере или от неё — приблизить или отдалить. Разжал — отпустил.',
      },
      head: {
        title: 'Подвигай головой',
        text: 'Влево-вправо, вверх-вниз. Экран — окно: загляни в мир сбоку.',
      },
      menu: {
        title: 'Две ладони — меню',
        text: 'Раскрой обе ладони и подержи секунду — откроется меню: пауза, заново, лобби, размер и место круга.',
      },
    },
    step: (n, of) => `Шаг ${n} из ${of}`,
    done: 'Отлично! Поехали',
    skip: 'Пропустить обучение — наведи левой рукой',
  },
  hud: {
    go: 'Вперёд!',
    lobby: 'Лобби — зайди в портал, чтобы начать уровень',
    secret: 'тайные',
    holding: 'держишь мир',
    legend: ['ладонь в круг — готов', 'сдвинь ладонь — иди', 'кулак — прыжок', 'левый кулак — поворот, наклон, зум', 'две ладони — меню'],
    menuHold: 'Меню…',
  },
  menu: {
    title: 'Меню',
    lead: 'Наведи палец на кнопку и подержи секунду.',
    resume: 'Продолжить',
    restart: 'Заново',
    lobby: 'В лобби',
    grab: (pct) => `Поворот мира левым кулаком — ${pct}%`,
    slower: 'Медленнее',
    faster: 'Быстрее',
    ring: (pct) => `Круг-джойстик — ${pct}%`,
    smaller: 'Меньше',
    bigger: 'Больше',
    place: 'Поставить заново',
    langTitle: 'Язык',
    otherLang: 'English',
    setupTitle: 'Поставь круг',
    setupLead: 'Подними правую ладонь там, где руке удобно (лучше низко справа), и подержи секунду.',
    setupFine: 'В окне камеры слева внизу жёлтый круг сейчас следует за ладонью.',
  },
  cam: {
    rightNone: 'Правая: нет',
    leftNone: 'Левая: нет',
    leftSeen: 'Левая: видна',
    rightSeen: 'Правая: видна',
    rightFist: 'Правая: кулак → прыжок',
    rightCalibrating: 'Правая: держи — ставлю круг',
    rightArm: 'Правая: заведи в жёлтый круг',
    rightBack: 'Правая: верни в круг',
    rightWalk: ['Правая: идёт вправо', 'Правая: идёт вперёд', 'Правая: идёт влево', 'Правая: идёт назад'],
    rightStop: 'Правая: стоп',
    leftZoom: (zoom) => `Левая: зум ×${zoom}`,
    leftSpin: 'Левая: мир крутится сам',
    leftHold: 'Левая: держишь мир',
    leftFist: 'Левая: кулак — веди или толкай',
    fps: (n) => `камера ${n} к/с`,
  },
  debug: {
    left: (fist) => `левая ${fist ? 'кулак ✓' : 'открыта'}`,
    leftNone: 'левая —',
    fingers: (marks) => `пальцы ${marks}`,
    head: (x, y, z) => `голова x${x} y${y} z${z} см`,
    faceNone: 'лицо —',
    infer: (ms) => `распозн. ${ms} мс`,
    render: (fps, sharp, eco) => `рендер ${fps} к/с · чёткость ${sharp}%${eco ? ' · эконом' : ''}`,
    poseNone: 'поза —',
    poseNoArms: 'поза: нет плеч',
    pose: (left, right) => `поза: Л${left ? '✓' : '—'} П${right ? '✓' : '—'}`,
  },
  pad: {
    walk: ['Иду вправо', 'Иду вперёд', 'Иду влево', 'Иду назад'],
    raise: 'Подними ладонь',
    jump: 'Прыжок',
    center: 'Ладонь в центр',
    back: 'Верни в центр',
    stop: 'Стоп',
  },
  lost: {
    black: 'Камера показывает чёрный кадр. Открой шторку камеры или закрой программу, которая её заняла.',
    frozen: 'Камера перестала присылать картинку. Проверь, что она включена и её не заняла другая программа.',
    ended: 'Камера отключилась. Включи её (кнопкой на ноутбуке или в настройках) — игра подключится сама.',
    backTitle: 'Вижу тебя снова',
    backCount: (n) => `Продолжаем через ${n}…`,
    backNow: 'Сейчас продолжим…',
    title: 'Камера не видит',
    paused: 'Игра на паузе, таймер стоит. Как только камера заработает, продолжим с того же места.',
  },
  hints: {
    fingers: ['большой', 'указательный', 'средний', 'безымянный', 'мизинец'],
    rightHand: 'Правая рука',
    leftHand: 'Левая рука',
    edgeLeft: (who) => `${who} уходит за левый край кадра — сдвинь её правее`,
    edgeRight: (who) => `${who} уходит за правый край кадра — сдвинь её левее`,
    edgeLow: (who) => `${who} слишком низко — подними её выше, в центр кадра`,
    edgeHigh: (who) => `${who} слишком высоко — опусти её ниже`,
    cameraLost: 'Камера перестала присылать картинку — проверь, что она включена и её не заняла другая программа. Игра подключится к ней сама',
    cameraBlocked: 'Камера показывает чёрный кадр — открой шторку камеры или закрой программу, которая её заняла',
    dark: 'Слишком темно — включи свет или повернись лицом к окну',
    noFace: 'Не вижу лицо — сядь прямо напротив камеры',
    tooClose: (cm) => `Слишком близко к экрану — отодвинься примерно на ${cm} см`,
    tooFar: (cm) => `Далеко от камеры — подвинься ближе примерно на ${cm} см`,
    headTurned: 'Голова повёрнута в сторону — повернись лицом к экрану. Двигай головой, а не поворачивай её',
    noHands: 'Подними правую ладонь — появится красная точка. Заведи её в жёлтый центр джойстика справа внизу',
    handTurned: 'Камера потеряла левую руку — держи кулак костяшками к камере, не ребром',
    wrongHand: 'Ходьба — правой рукой. Левой сожми кулак, чтобы повернуть мир',
    fistPartial: (fingers) => `Чтобы прыгнуть, сожми кулак полностью — не согнут${fingers.length > 1 ? 'ы' : ''}: ${fingers.join(', ')}`,
    palmNotArmed: 'Заведи красную точку — свою правую ладонь — в жёлтый центр джойстика справа внизу. Тогда герой пойдёт',
  },
  advice: {
    'camera-blocked': { title: 'Камера не видит', tip: 'Открой шторку камеры и проверь, что её не заняла другая программа.' },
    'camera-lost': { title: 'Камера отключалась', tip: 'Проверь, что камеру не выключает кнопка на ноутбуке и её не заняла другая программа.' },
    'fist-partial': { title: 'Неполный кулак', tip: 'Сжимай все четыре пальца разом — как будто хватаешь ручку.' },
    'hand-edge': { title: 'Рука у края кадра', tip: 'Держи руки ближе к груди, в центре кадра.' },
    'palm-not-armed': { title: 'Ладонь не в круге', tip: 'Сначала заведи красную точку — свою ладонь — в жёлтый центр джойстика справа внизу.' },
    'wrong-hand': { title: 'Не та рука', tip: 'Правая — ходьба и прыжок, левая — поворот мира.' },
    'no-hands': { title: 'Руки вне кадра', tip: 'Держи правую ладонь низко справа, в круге джойстика.' },
    'no-face': { title: 'Лицо вне кадра', tip: 'Сядь напротив камеры, чтобы работал эффект окна.' },
    'too-close': { title: 'Слишком близко', tip: 'Лучшее расстояние — 50–70 см от экрана.' },
    'too-far': { title: 'Слишком далеко', tip: 'Лучшее расстояние — 50–70 см от экрана.' },
    'head-turned': { title: 'Голова повёрнута', tip: 'Смотри на экран прямо — двигай головой, а не поворачивай её.' },
    dark: { title: 'Мало света', tip: 'Свет должен падать на лицо и руки, а не из-за спины.' },
    'hand-turned': { title: 'Левая рука пропала', tip: 'Держи кулак костяшками к камере — ребром руку не видно.' },
  },
  results: {
    complete: (level) => `Уровень «${level}» пройден`,
    points: (n) => `${n} очков`,
    stars: 'звёзд',
    time: 'время',
    sec: 'с',
    accuracy: 'точность жестов',
    falls: 'падений',
    review: 'Разбор ошибок',
    clean: 'Ни одной ошибки в жестах — чисто!',
    count: (n) => ` — ${n} ${ruTimes(n)}`,
    records: 'Рекорды',
    you: ' (ты)',
    missed: (name) => `Ты — ${name}. До таблицы не хватило совсем чуть-чуть.`,
    next: (level) => `Дальше: ${level}`,
    again: 'Сыграть ещё',
    lobby: 'В лобби',
  },
  names: {
    adj: ['Смелый', 'Быстрый', 'Ловкий', 'Хитрый', 'Весёлый', 'Зоркий', 'Прыгучий', 'Тихий'],
    noun: ['Лис', 'Барс', 'Ёж', 'Филин', 'Кот', 'Сокол', 'Волк', 'Енот'],
  },
  levels: {
    level1: { title: 'Острова', feature: 'ходьба и прыжки' },
    level2: { title: 'Загляни', feature: 'двигай головой' },
    level3: { title: 'Поверни мир', feature: 'левый кулак' },
  },
  lobby: {
    soon: 'скоро',
    best: (score) => `рекорд ${score}`,
  },
  level2: {
    line1: 'В двориках за стенами спрятаны тайные звёзды.',
    line2: 'Подними голову — загляни через стену. Или сожми левый кулак и потяни мир вниз. Увидел звезду — она твоя!',
    gate: (found, total) => `Ворота откроются: тайные звёзды ${found}/${total}`,
  },
  level3: {
    line1: 'Мосты собираются только под нужным углом.',
    line2: 'Сожми левый кулак и веди в сторону — доски съедутся в мост.',
    bridgeOk: 'Мост собран — вперёд!',
    bridgeRight: 'Поверни мир: левый кулак → веди вправо',
    bridgeLeft: 'Поверни мир: левый кулак → веди влево',
  },
}

const DICT: Record<Lang, Dict> = { en, ru }
const KEY = 'okno.lang'

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru'

function initialLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    if (isLang(q)) return q
  } catch {
    // нет location (тесты) — дальше
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (isLang(saved)) return saved
  } catch {
    // localStorage недоступен (приватный режим, тесты)
  }
  return 'en'
}

/** Язык страницы и заголовок вкладки. */
function applyToDocument(lang: Lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.title = DICT[lang].docTitle
}

export const useLang = create<{ lang: Lang; setLang: (lang: Lang) => void }>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      // не запомнили — язык всё равно сменится до перезагрузки
    }
    applyToDocument(lang)
    set({ lang })
  },
}))

applyToDocument(useLang.getState().lang)

export const lang = () => useLang.getState().lang
/** Словарь текущего языка — для кода вне React (подсказки, подписи на холсте). */
export const t = () => DICT[lang()]
/** Словарь текущего языка в компоненте: при смене языка компонент перерисуется. */
export function useT() {
  return DICT[useLang((s) => s.lang)]
}
