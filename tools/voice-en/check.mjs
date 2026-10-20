// Проверка английской озвучки без ушей: каждую public/voice/en/<id>.mp3 распознаём моделью Whisper
// и сравниваем слова с полем en в src/game/voiceLines.json. Тембр и интонацию так не проверить — только слова.
// npm run check   (нужен ffmpeg, как для make.mjs)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from '@huggingface/transformers'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const LINES = Object.values(JSON.parse(readFileSync(join(ROOT, 'src/game/voiceLines.json'), 'utf8'))).flat()
const FFMPEG = process.env.FFMPEG || 'ffmpeg'

/** mp3 → 16 кГц моно float32, как ждёт Whisper. */
function pcm16k(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`ffmpeg ${file}\n${r.stderr}`)
  const b = r.stdout
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Расстояние Левенштейна по словам: сколько слов не совпало. */
function wordErrors(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', { dtype: 'q8', device: 'cpu' })
let bad = 0
// node check.mjs --only short.pause,jump.ok — проверить только эти реплики.
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null
const checked = ONLY ? LINES.filter((l) => ONLY.includes(l.id)) : LINES
for (const line of checked) {
  const file = join(ROOT, 'public/voice/en', `${line.id}.mp3`)
  const { text } = await asr(pcm16k(file))
  const want = words(line.en)
  const got = words(text)
  const errors = wordErrors(want, got)
  const ok = errors === 0
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${line.id.padEnd(20)} ${ok ? '' : `${errors} сл.  `}«${text.trim()}»`)
}
console.log(bad ? `[check] расхождений: ${bad} из ${checked.length}` : `[check] все ${checked.length} реплик совпали с текстом`)
