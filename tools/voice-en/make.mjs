// Английский голос «Окна»: Kokoro-82M (Apache-2.0) прямо на ноутбуке, без ключей и аккаунтов.
// Текст — поле en (или enSay, если слово надо подсказать по звучанию) в src/game/voiceLines.json,
// результат — public/voice/en/<id>.mp3 в том же формате, что русские реплики: -18 LUFS, 128 кбит/с, 44,1 кГц, моно.
//
// npm install && npm run make                      — все реплики голосом af_bella
// node make.mjs --voice af_heart --only jump.ok    — одна реплика другим голосом
// node make.mjs --out samples --prefix             — в другую папку, имя файла с голосом впереди
// Нужен ffmpeg (winget install Gyan.FFmpeg) — в PATH или в переменной FFMPEG.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KokoroTTS } from 'kokoro-js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const LINES = Object.values(JSON.parse(readFileSync(join(ROOT, 'src/game/voiceLines.json'), 'utf8'))).flat()

const args = process.argv.slice(2)
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const VOICE = arg('voice', 'af_bella')
const SPEED = Number(arg('speed', '1'))
const OUT = resolve(HERE, arg('out', join(ROOT, 'public/voice/en')))
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const PREFIX = args.includes('--prefix')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'

/** Громкость как у русских реплик (scripts/cut-voice.mjs). */
const LOUDNESS = -18
/** Тишина по краям: срезаем, потом оставляем столько же, сколько у русских реплик. */
const PAD_BEFORE = 0.06
const PAD_AFTER = 0.12

function ffmpeg(a) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-y', ...a], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg ${a.join(' ')}\n${r.stderr}`)
  return r.stderr
}

const lines = ONLY.length ? LINES.filter((l) => ONLY.includes(l.id)) : LINES
if (!lines.length) throw new Error(`[voice-en] нет реплик ${ONLY.join(', ')}`)
for (const l of lines) if (!l.en) throw new Error(`[voice-en] у реплики ${l.id} нет поля en`)

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' })
mkdirSync(OUT, { recursive: true })
const raw = join(tmpdir(), `okno-voice-en-${process.pid}.wav`)
const trimmed = join(tmpdir(), `okno-voice-en-${process.pid}-trim.wav`)

for (const line of lines) {
  const audio = await tts.generate(line.enSay ?? line.en, { voice: VOICE, speed: SPEED })
  await audio.save(raw)
  // Срезать тишину в начале и в конце, затем добавить ровные поля.
  const edge = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02'
  ffmpeg([
    '-i', raw,
    '-af', `${edge},areverse,${edge},areverse,adelay=${PAD_BEFORE * 1000}:all=1,apad=pad_dur=${PAD_AFTER}`,
    '-ar', '44100', '-ac', '1', trimmed,
  ])
  // Громкость в два прохода, как в cut-voice.mjs.
  const filter = `loudnorm=I=${LOUDNESS}:TP=-1.5:LRA=11`
  const log = ffmpeg(['-i', trimmed, '-af', `${filter}:print_format=json`, '-f', 'null', '-'])
  const m = JSON.parse(log.match(/\{[^{}]*"input_i"[^{}]*\}/)[0])
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`
  const name = `${PREFIX ? `${VOICE}.` : ''}${line.id}.mp3`
  ffmpeg([
    '-i', trimmed, '-af', `${filter}:${measured}:linear=true`,
    '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', join(OUT, name),
  ])
  console.log(`[voice-en] ${name}  ${(audio.audio.length / audio.sampling_rate).toFixed(1)} с  «${line.en}»`)
}

rmSync(raw, { force: true })
rmSync(trimmed, { force: true })
console.log(`[voice-en] готово: ${lines.length} реплик голосом ${VOICE} в ${OUT}`)
