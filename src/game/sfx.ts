/**
 * Звуки, синтезированные прямо в браузере (Web Audio) — без файлов.
 * Браузер разрешает звук только после клика, поэтому unlockAudio() вызывается на кнопке старта.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null

const MASTER_GAIN = 0.35
/** Пока говорит голос, эффекты тише во столько раз. */
const DUCKED = 0.4

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
}

/** Общий аудиоконтекст (голос играет в нём же). null — звук ещё не разрешён кликом. */
export function audioContext() {
  return ctx
}

/** Голос говорит — эффекты приглушаем, замолчал — возвращаем. */
export function duckSfx(on: boolean) {
  if (!ctx || !master) return
  const t = ctx.currentTime
  master.gain.cancelScheduledValues(t)
  master.gain.setTargetAtTime(MASTER_GAIN * (on ? DUCKED : 1), t, on ? 0.05 : 0.3)
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.5, slideTo?: number, delay = 0) {
  if (!ctx || !master) return
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(dur: number, gain = 0.3, lowpass = 800) {
  if (!ctx || !master) return
  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = lowpass
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(master)
  src.start()
}

export const sfx = {
  jump: () => tone(320, 0.18, 'square', 0.18, 720),
  land: () => noise(0.12, 0.35, 500),
  star: () => {
    tone(988, 0.12, 'triangle', 0.35)
    tone(1319, 0.25, 'triangle', 0.35, undefined, 0.08)
  },
  fall: () => tone(600, 0.6, 'sawtooth', 0.15, 90),
  tick: () => tone(1200, 0.05, 'sine', 0.2),
  confirm: () => {
    tone(660, 0.1, 'triangle', 0.3)
    tone(990, 0.18, 'triangle', 0.3, undefined, 0.07)
  },
  hint: () => tone(440, 0.16, 'sine', 0.18, 380),
  count: (last = false) => tone(last ? 1046 : 523, last ? 0.4 : 0.15, 'square', 0.18),
  finish: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.3, undefined, i * 0.1)),
  /** Голограмма рассыпалась — жест повторён: тихий «стеклянный» перезвон вверх. */
  holo: () => [1319, 1760, 2637].forEach((f, i) => tone(f, 0.9 - i * 0.15, 'sine', 0.13 - i * 0.03, undefined, i * 0.07)),
}
