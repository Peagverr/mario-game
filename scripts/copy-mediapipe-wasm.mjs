// Кладёт файлы MediaPipe (wasm) в public/, чтобы сайт не зависел от чужого CDN.
import { cpSync, existsSync } from 'node:fs'

const from = 'node_modules/@mediapipe/tasks-vision/wasm'
const to = 'public/mediapipe/wasm'

if (existsSync(from)) {
  cpSync(from, to, { recursive: true })
  console.log(`[mediapipe] wasm скопирован в ${to}`)
}
