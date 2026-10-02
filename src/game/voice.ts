import { audioContext, duckSfx } from './sfx'
import LINES from './voiceLines.json'
import { VoiceQueue } from './voiceQueue'

/**
 * Голос «Окна» — заранее озвученные реплики (ElevenLabs), по файлу на реплику: public/voice/<id>.mp3.
 * Тексты и id — в voiceLines.json, нарезка — scripts/cut-voice.mjs (`npm run voice`).
 * Кто и когда говорит — правила в voiceQueue.ts; здесь только звук.
 */

const TEXT = new Map(Object.values(LINES).flat().map((l) => [l.id, l.text]))
const VOLUME = 1
/** Сколько по умолчанию реплика ждёт своей очереди (мс). */
const DEFAULT_WAIT_MS = 2500

export const PRIORITY = { reaction: 1, hint: 2, story: 3 } as const

const queue = new VoiceQueue()
const buffers = new Map<string, Promise<AudioBuffer | null>>()
let bus: GainNode | null = null
let analyser: AnalyserNode | null = null
let levelData: Uint8Array<ArrayBuffer> | null = null
let ticking = false

/** Что говорится сейчас — для субтитров. */
export const voiceNow = { id: '', text: '' }

function load(id: string) {
  let p = buffers.get(id)
  if (!p) {
    const ctx = audioContext()
    p = ctx
      ? fetch(`${import.meta.env.BASE_URL}voice/${id}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .catch((e) => {
            console.warn(`[voice] не загрузилась реплика ${id}`, e)
            return null
          })
      : Promise.resolve(null)
    if (ctx) buffers.set(id, p)
  }
  return p
}

/** Голос говорит или реплики ждут очереди — обучение не торопится к следующему шагу. */
export function voiceBusy() {
  return !!queue.playing || queue.pending > 0
}

/** Есть ли озвученная реплика с таким id. */
export function hasLine(id: string) {
  return TEXT.has(id)
}

/** После клика «Включить камеру» — заранее загрузить все реплики, чтобы голос звучал без задержки. */
export function preloadVoice() {
  for (const id of TEXT.keys()) void load(id)
}

/**
 * Сказать реплику. Не перебивает текущую: встанет в очередь и подождёт `waitMs`.
 * once — ключ «только один раз за сессию»; valid — проверка «ещё к месту?» прямо перед тем, как сказать.
 */
export function say(
  id: string,
  opts: { priority?: number; waitMs?: number; once?: string; valid?: () => boolean } = {},
) {
  if (!TEXT.has(id)) {
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
  const buf = ctx && (await load(id))
  if (!ctx || !buf) {
    queue.done(performance.now())
    return
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(output(ctx))
  voiceNow.id = id
  voiceNow.text = TEXT.get(id) ?? ''
  duckSfx(true)
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
