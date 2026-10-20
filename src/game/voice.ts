import { lang, useLang, type Lang } from '../i18n'
import { audioContext, duckSfx } from './sfx'
import LINES from './voiceLines.json'
import { VoiceQueue } from './voiceQueue'

/**
 * Голос «Окна» — заранее озвученные реплики, по файлу на реплику:
 * русский (ElevenLabs) — public/voice/<id>.mp3, нарезка scripts/cut-voice.mjs (`npm run voice`);
 * английский (Kokoro-82M) — public/voice/en/<id>.mp3, озвучка tools/voice-en (`npm run make` там).
 * Тексты и id — в voiceLines.json (text — русский, en — английский).
 * Кто и когда говорит — правила в voiceQueue.ts; здесь только звук.
 */

type Line = { id: string; text: string; en: string }
const ALL = Object.values(LINES).flat() as Line[]
const TEXT: Record<Lang, Map<string, string>> = {
  ru: new Map(ALL.map((l) => [l.id, l.text])),
  en: new Map(ALL.map((l) => [l.id, l.en])),
}
const DIR: Record<Lang, string> = { ru: 'voice/', en: 'voice/en/' }
const VOLUME = 1
/** Сколько по умолчанию реплика ждёт своей очереди (мс). */
const DEFAULT_WAIT_MS = 2500

export const PRIORITY = { reaction: 1, hint: 2, story: 3 } as const

const queue = new VoiceQueue()
/** Ключ — язык и id: «en:jump.ok». */
const buffers = new Map<string, Promise<AudioBuffer | null>>()
let bus: GainNode | null = null
let analyser: AnalyserNode | null = null
let levelData: Uint8Array<ArrayBuffer> | null = null
let ticking = false

/** Что говорится сейчас — для субтитров. */
export const voiceNow = { id: '', text: '' }

function load(id: string, l: Lang) {
  const key = `${l}:${id}`
  let p = buffers.get(key)
  if (!p) {
    const ctx = audioContext()
    p = ctx
      ? fetch(`${import.meta.env.BASE_URL}${DIR[l]}${id}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .catch((e) => {
            console.warn(`[voice] не загрузилась реплика ${key}`, e)
            return null
          })
      : Promise.resolve(null)
    if (ctx) buffers.set(key, p)
  }
  return p
}

/** Голос говорит или реплики ждут очереди — обучение не торопится к следующему шагу. */
export function voiceBusy() {
  return !!queue.playing || queue.pending > 0
}

/** Есть ли озвученная реплика с таким id. */
export function hasLine(id: string) {
  return TEXT.ru.has(id)
}

let preloaded = false

/** После клика «Включить камеру» — заранее загрузить все реплики, чтобы голос звучал без задержки. */
export function preloadVoice() {
  preloaded = true
  const l = lang()
  for (const id of TEXT[l].keys()) void load(id, l)
}

// Сменили язык после старта — заранее загрузить реплики и на нём.
useLang.subscribe((s, p) => {
  if (preloaded && s.lang !== p.lang) preloadVoice()
})

/**
 * Сказать реплику. Не перебивает текущую: встанет в очередь и подождёт `waitMs`.
 * once — ключ «только один раз за сессию»; valid — проверка «ещё к месту?» прямо перед тем, как сказать.
 */
export function say(
  id: string,
  opts: { priority?: number; waitMs?: number; once?: string; valid?: () => boolean } = {},
) {
  if (!TEXT.ru.has(id)) {
    console.warn(`[voice] нет реплики ${id}`)
    return
  }
  queue.push({
    id,
    priority: opts.priority ?? PRIORITY.reaction,
    expiresAt: performance.now() + (opts.waitMs ?? DEFAULT_WAIT_MS),
    once: opts.once,
    valid: opts.valid,
  })
  startTicking()
}

/** Новый забег или сцена: несказанное уже не к месту. */
export function clearVoice() {
  queue.clear()
}

/** Громкость голоса сейчас, 0..1 — чтобы голограмма светилась в такт речи. */
export function voiceLevel() {
  if (!analyser || !levelData) return 0
  analyser.getByteTimeDomainData(levelData)
  let sum = 0
  for (const v of levelData) sum += ((v - 128) / 128) ** 2
  return Math.min(1, Math.sqrt(sum / levelData.length) * 4)
}

function output(ctx: AudioContext) {
  if (!bus) {
    bus = ctx.createGain()
    bus.gain.value = VOLUME
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    levelData = new Uint8Array(analyser.fftSize)
    bus.connect(analyser)
    analyser.connect(ctx.destination)
  }
  return bus
}

function startTicking() {
  if (ticking) return
  ticking = true
  // Пока кто-то говорит или ждёт очереди — проверяем; стало тихо и пусто — засыпаем до следующего say().
  const tick = () => {
    const item = queue.take(performance.now())
    if (item) void play(item.id)
    if (queue.playing || queue.pending) setTimeout(tick, 100)
    else ticking = false
  }
  tick()
}

async function play(id: string) {
  const ctx = audioContext()
  const l = lang()
  let buf = ctx && (await load(id, l))
  // Английского файла нет — русский звучит беззвучно, только чтобы субтитр шёл с тем же таймингом.
  const muted = !buf && l !== 'ru'
  if (ctx && muted) buf = await load(id, 'ru')
  if (!ctx || !buf) {
    queue.done(performance.now())
    return
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  if (muted) {
    const silent = ctx.createGain()
    silent.gain.value = 0
    src.connect(silent)
    silent.connect(output(ctx))
  } else src.connect(output(ctx))
  voiceNow.id = id
  voiceNow.text = TEXT[l].get(id) ?? ''
  if (!muted) duckSfx(true)
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    voiceNow.id = ''
    voiceNow.text = ''
    duckSfx(false)
    queue.done(performance.now())
  }
  src.onended = finish
  // Звук браузер приостановил (вкладка в фоне) — onended не придёт; голос не должен застрять навсегда.
  setTimeout(finish, buf.duration * 1000 + 1500)
  src.start()
}
