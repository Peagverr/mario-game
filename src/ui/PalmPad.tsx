import { useEffect, useRef, useState } from 'react'
import { runtime } from '../game/runtime'
import { control } from '../shared/controlState'

/**
 * Большой джойстик в правом нижнем углу экрана — там, где его ждут глаза (как в мобильных играх).
 * Он повторяет круг в кадре камеры (тоже справа внизу): правая ладонь в круге — точка в центре джойстика.
 *
 * Жёлтый центр пунктиром — «заведи ладонь сюда», зелёный — «готов». Ладонь вышла из центра —
 * сектор подсвечен кораллом, от центра к точке — «палка». Размер круга и усиление вниз — как у ходьбы
 * (control.joystick.stick*), поэтому точка выходит из центра ровно тогда, когда герой пошёл.
 */

const COLORS = { ink: '#1d2340', paper: 'rgba(255,253,248,0.82)', coral: '#ff5a5f', wait: '#ffd23f', ready: '#9be15d', cream: '#fff7ea' }
/** Секторы: 0 вправо, 1 вперёд, 2 влево, 3 назад. */
const WALK = ['Иду вправо', 'Иду вперёд', 'Иду влево', 'Иду назад']

type Caption = { text: string; tone: 'wait' | 'ok' | 'go' }

function caption(): Caption {
  const j = control.joystick
  const r = control.hands.right
  // Коротко — не шире круга: полная инструкция и так в подсказке «режима ошибки».
  if (!r) return { text: 'Подними ладонь', tone: 'wait' }
  if (r.fist) return { text: 'Прыжок', tone: 'go' }
  if (!j.armed) return { text: 'Ладонь в центр', tone: 'wait' }
  if (runtime.moveLocked) return { text: 'Верни в центр', tone: 'wait' }
  return j.sector >= 0 ? { text: WALK[j.sector], tone: 'go' } : { text: 'Стоп', tone: 'ok' }
}

function draw(ctx: CanvasRenderingContext2D, size: number, t: number) {
  const j = control.joystick
  const c = size / 2
  /** Подложка (с местом под тень снизу), край полной скорости и центр «стоп». */
  const base = c - 7
  const full = base - 16
  const dead = j.radius > 0 ? full * Math.min(0.8, j.deadRadius / j.radius) : full * 0.45
  const waiting = !j.armed || j.calibrating || runtime.moveLocked
  const going = j.armed && j.sector >= 0 && !runtime.moveLocked

  ctx.clearRect(0, 0, size, size)

  // Подложка — как карточки интерфейса: бумага, чернильная обводка и тень снизу.
  ctx.fillStyle = COLORS.ink
  ctx.beginPath()
  ctx.arc(c, c + 4, base, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = COLORS.paper
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(c, c, base, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Сектор, куда идём, — подсвечен.
  if (going) {
    const mid = (-j.sector * Math.PI) / 2
    ctx.fillStyle = 'rgba(255,90,95,0.5)'
    ctx.beginPath()
    ctx.arc(c, c, base - 2, mid - Math.PI / 4, mid + Math.PI / 4)
    ctx.arc(c, c, dead, mid + Math.PI / 4, mid - Math.PI / 4, true)
    ctx.closePath()
    ctx.fill()
  }

  // Край полной скорости и крест между секторами.
  ctx.strokeStyle = 'rgba(29,35,64,0.3)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(c, c, full, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(29,35,64,0.22)'
  ctx.beginPath()
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    ctx.moveTo(c + Math.cos(a) * dead, c + Math.sin(a) * dead)
    ctx.lineTo(c + Math.cos(a) * (base - 3), c + Math.sin(a) * (base - 3))
  }
  ctx.stroke()

  // Центр: жёлтый и пульсирует — «заведи ладонь сюда»; зелёный — готов.
  ctx.fillStyle = waiting ? COLORS.wait : COLORS.ready
  ctx.globalAlpha = waiting ? 0.55 + 0.3 * Math.sin(t / 180) : 0.85
  ctx.beginPath()
  ctx.arc(c, c, dead, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 2.5
  if (waiting) ctx.setLineDash([6, 5])
  ctx.stroke()
  ctx.setLineDash([])

  // Стрелки направлений посередине секторов — треугольники остриём наружу.
  const ra = (dead + base) / 2
  const tip = size * 0.055
  ctx.lineJoin = 'round'
  for (let i = 0; i < 4; i++) {
    const a = (-i * Math.PI) / 2
    const x = c + Math.cos(a) * ra
    const y = c + Math.sin(a) * ra
    const active = going && i === j.sector
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * tip, y + Math.sin(a) * tip)
    ctx.lineTo(x + Math.cos(a + 2.3) * tip, y + Math.sin(a + 2.3) * tip)
    ctx.lineTo(x + Math.cos(a - 2.3) * tip, y + Math.sin(a - 2.3) * tip)
    ctx.closePath()
    ctx.fillStyle = active ? COLORS.cream : 'rgba(29,35,64,0.7)'
    ctx.fill()
    if (active) {
      ctx.strokeStyle = COLORS.ink
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
  }

  // Ладонь: точка там, где она относительно круга в кадре. Дальше края — прижата к краю.
  if (!j.stickVisible) return
  let sx = j.stickX
  let sy = j.stickY
  const len = Math.hypot(sx, sy)
  const maxLen = (base - 12) / full
  if (len > maxLen) {
    sx *= maxLen / len
    sy *= maxLen / len
  }
  const px = c + sx * full
  const py = c - sy * full
  if (!j.armed) {
    // К центру — пунктир «сюда».
    ctx.strokeStyle = COLORS.ink
    ctx.globalAlpha = 0.55
    ctx.setLineDash([4, 5])
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(c, c)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  } else if (going) {
    ctx.strokeStyle = COLORS.coral
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.lineTo(px, py)
    ctx.stroke()
  }
  const dot = Math.max(8, size * 0.06)
  ctx.fillStyle = COLORS.coral
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(px, py, dot, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = COLORS.cream
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(px, py, dot - 3, 0, Math.PI * 2)
  ctx.stroke()
}

export function PalmPad() {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [cap, setCap] = useState<Caption>(caption)

  useEffect(() => {
    let raf = 0
    let frame = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = canvas.current
      const ctx = el?.getContext('2d')
      if (!el || !ctx || !root.current) return
      const j = control.joystick
      // Круга нет (камера не запущена) или открывается меню — джойстик прячем.
      root.current.classList.toggle('is-hidden', j.radius <= 0 || j.suspended)
      // Размер — из CSS (на узком экране джойстик меньше).
      const size = el.clientWidth
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (el.width !== Math.round(size * dpr)) {
        el.width = Math.round(size * dpr)
        el.height = Math.round(size * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, size, performance.now())
      if (frame++ % 6 === 0) {
        const next = caption()
        const key = next.text + next.tone
        if (key !== last) {
          last = key
          setCap(next)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={root} className="palm-pad is-hidden" aria-hidden>
      <span className={`palm-pad__caption is-${cap.tone}`}>{cap.text}</span>
      <canvas ref={canvas} />
    </div>
  )
}
