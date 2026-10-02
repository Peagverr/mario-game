import { useEffect, useRef, useState } from 'react'
import { startTracking } from '../../input/tracker'
import { control, type HandState } from '../../shared/controlState'
import { decodeClip, encodeClip, type HandSide } from './clip'
import { CLIP_NAMES, putClip } from './clips'
import { labState } from './labState'
import { recordingToClip, type RecordedSample } from './recording'

/**
 * Запись живой руки для голограммы (`?record`): R — отсчёт 3 с и запись 3 с, L — какая рука, N — какой клип заменить.
 * Готовая запись скачивается JSON-файлом (положить в src/game/holo/clips/ — заменит процедурный клип)
 * и сразу показывается голограммой — видно, что получилось.
 */

const COUNTDOWN_S = 3
const RECORD_S = 3

type Status = { kind: 'off' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'countdown'; left: number } | { kind: 'recording'; left: number } | { kind: 'saved'; name: string; frames: number }

export function Recorder() {
  const [status, setStatus] = useState<Status>({ kind: 'off' })
  const [side, setSide] = useState<HandSide>('right')
  const [name, setName] = useState<string>(CLIP_NAMES[0])
  const [seen, setSeen] = useState(false)
  const busy = useRef(false)
  const opts = useRef({ side, name })
  opts.current = { side, name }

  const start = async () => {
    setStatus({ kind: 'loading' })
    try {
      await startTracking(() => {})
      setStatus({ kind: 'ready' })
    } catch (e) {
      console.error(e)
      setStatus({ kind: 'off' })
    }
  }

  // Видна ли нужная рука — подсказка прямо на панели.
  useEffect(() => {
    const id = setInterval(() => setSeen(!!control.hands[opts.current.side]?.world), 200)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyL') setSide((s) => (s === 'right' ? 'left' : 'right'))
      if (e.code === 'KeyN') setName((n) => CLIP_NAMES[(CLIP_NAMES.indexOf(n as never) + 1) % CLIP_NAMES.length])
      if (e.code === 'KeyR' && control.tracking.ready && !busy.current) void record()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function record() {
    busy.current = true
    const { side: hand, name: clipName } = opts.current
    for (let left = COUNTDOWN_S; left > 0; left--) {
      setStatus({ kind: 'countdown', left })
      await wait(1000)
    }
    const samples: RecordedSample[] = []
    let last: HandState | null = null
    const t0 = performance.now()
    await new Promise<void>((done) => {
      const tick = () => {
        const now = performance.now()
        const h = control.hands[hand]
        // Новый кадр трекера — новый объект; одинаковые кадры не пишем дважды.
        if (h && h !== last && h.world?.length === 21) {
          last = h
          samples.push({ t: now / 1000, world: h.world, palm: h.palm, size: h.size })
        }
        setStatus({ kind: 'recording', left: Math.max(0, RECORD_S - (now - t0) / 1000) })
        if (now - t0 < RECORD_S * 1000) requestAnimationFrame(tick)
        else done()
      }
      requestAnimationFrame(tick)
    })
    busy.current = false
    if (samples.length < 10) {
      setStatus({ kind: 'ready' })
      console.warn('[holo] рука почти не была видна — запись не сохранена')
      return
    }
    const v = control.tracking.video
    const aspect = v && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3
    const file = encodeClip(recordingToClip(samples, clipName, hand, aspect))
    putClip(decodeClip(file))
    labState.pin = clipName
    download(`${clipName}.json`, JSON.stringify(file))
    setStatus({ kind: 'saved', name: clipName, frames: file.frames.length })
  }

  return (
    <div className="holo-rec">
      <b>Запись жеста</b>
      {status.kind === 'off' && (
        <button className="big-btn" onClick={start}>
          Включить камеру
        </button>
      )}
      {status.kind === 'loading' && <span>Загружаем камеру и распознавание…</span>}
      {status.kind !== 'off' && status.kind !== 'loading' && (
        <>
          <span>
            Рука: <b>{side === 'right' ? 'правая' : 'левая'}</b> (L) · клип: <b>{name}</b> (N) · {seen ? 'рука видна' : 'руки не видно'}
          </span>
          {status.kind === 'ready' && <span>R — отсчёт {COUNTDOWN_S} с и запись {RECORD_S} с</span>}
          {status.kind === 'countdown' && <span className="holo-rec__big">{status.left}</span>}
          {status.kind === 'recording' && <span className="holo-rec__big is-rec">● {status.left.toFixed(1)}</span>}
          {status.kind === 'saved' && (
            <span>
              Сохранено: {status.name}.json ({status.frames} кадров) → положи в src/game/holo/clips/. R — ещё раз
            </span>
          )}
        </>
      )}
    </div>
  )
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function download(filename: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
