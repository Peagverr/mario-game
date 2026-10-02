// Нарезает озвучку: voice_raw/NN.mp3 (блок реплик из ElevenLabs, между репликами — пауза)
// → public/voice/<id>.mp3, по одному файлу на реплику. Какие реплики в каком блоке — src/game/voiceLines.json.
//
// Режем по самым длинным паузам: в блоке из N реплик берём N−1 самых длинных пауз
// (короткие паузы внутри фразы так не разрезаются). Громкость всех блоков выравниваем (loudnorm, два прохода).
// Переозвучили блок — положить новый файл в voice_raw/ и запустить `npm run voice`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const RAW = 'voice_raw'
const OUT = 'public/voice'
const LINES = JSON.parse(readFileSync('src/game/voiceLines.json', 'utf8'))
/** Громкость реплик (LUFS) — чуть тише музыки и эффектов не будет: эффекты приглушаются под голос. */
const LOUDNESS = -18
/** Тишина: тише этого и дольше этого. */
const NOISE_DB = -40
const MIN_SILENCE_S = 0.15
/** Сколько оставить перед началом и после конца реплики. */
const PAD_BEFORE = 0.06
const PAD_AFTER = 0.12

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`)
  return r.stderr
}

function duration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  return Number(r.stdout.trim())
}

function silences(file) {
  const log = ffmpeg(['-i', file, '-af', `silencedetect=noise=${NOISE_DB}dB:d=${MIN_SILENCE_S}`, '-f', 'null', '-'])
  const out = []
  let start = null
  for (const line of log.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/)
    const e = line.match(/silence_end: ([\d.]+)/)
    if (s) start = Number(s[1])
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) })
      start = null
    }
  }
  // Тишина до конца файла — silence_end не печатается.
  if (start !== null) out.push({ start, end: Infinity })
  return out
}

function normalize(src, dst) {
  const filter = `loudnorm=I=${LOUDNESS}:TP=-1.5:LRA=11`
  const log = ffmpeg(['-i', src, '-af', `${filter}:print_format=json`, '-f', 'null', '-'])
  const m = JSON.parse(log.match(/\{[^{}]*"input_i"[^{}]*\}/)[0])
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`
  ffmpeg(['-i', src, '-af', `${filter}:${measured}:linear=true`, '-ar', '44100', '-ac', '1', dst])
}

mkdirSync(OUT, { recursive: true })
const tmp = join(tmpdir(), `okno-voice-${process.pid}.wav`)
let total = 0

for (const [block, lines] of Object.entries(LINES)) {
  const raw = join(RAW, `${block}.mp3`)
  if (!existsSync(raw)) {
    console.warn(`[voice] нет ${raw} — блок пропущен`)
    continue
  }
  const len = duration(raw)
  const all = silences(raw)
  const leading = all.find((s) => s.start < 0.01)
  const trailing = all.find((s) => s.end === Infinity || s.end > len - 0.01)
  const inner = all.filter((s) => s !== leading && s !== trailing)
  if (inner.length < lines.length - 1) {
    throw new Error(`[voice] ${raw}: реплик ${lines.length}, а пауз между ними нашлось только ${inner.length}`)
  }
  const cuts = [...inner]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, lines.length - 1)
    .sort((a, b) => a.start - b.start)

  normalize(raw, tmp)
  const bounds = [leading ? leading.end : 0, ...cuts.flatMap((c) => [c.start, c.end]), trailing ? trailing.start : len]
  const report = []
  lines.forEach((line, i) => {
    const from = Math.max(0, bounds[i * 2] - PAD_BEFORE)
    const to = Math.min(len, bounds[i * 2 + 1] + PAD_AFTER)
    const d = to - from
    ffmpeg([
      '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', tmp,
      '-af', `afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, d - 0.06).toFixed(3)}:d=0.06`,
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '1',
      join(OUT, `${line.id}.mp3`),
    ])
    report.push(`${line.id} ${d.toFixed(1)}с`)
    total++
  })
  console.log(`[voice] ${block}: ${report.join(' · ')}`)
}

rmSync(tmp, { force: true })
console.log(`[voice] готово: ${total} реплик в ${OUT}/`)
