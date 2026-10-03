import { useEffect, useRef, useState } from 'react'
import { runtime } from '../game/runtime'
import { poseDebug } from '../input/tracker'
import { sfx } from '../game/sfx'
import { control, type HandState } from '../shared/controlState'

/**
 * Мини-окно с камерой и скелетом — обратная связь «система тебя видит».
 * Цвета: правая рука — коралловая (джойстик и прыжок), левая — бирюзовая (поворот мира).
 * Точки, на которые указывает подсказка «режима ошибки», подсвечиваются красным и пульсируют.
 *
 * Для ладони у лица это ещё и пульт: кольцо справа от лица, секторы крестом (вперёд, назад, вбок),
 * точка-ладонь и «палка» от центра. Жёлтый центр — «заведи ладонь сюда», зелёный — «готов».
 */

const W = 320
const H = 240
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
const COLORS = { right: '#ff5a5f', left: '#2ec4b6', bad: '#ff2d2d', wait: '#ffd23f', ready: '#9be15d', cream: '#fff7ea', ink: '#1d2340' }
/** Секторы кольца: 0 вправо, 1 вперёд, 2 влево, 3 назад — стрелка и подпись. */
const SECTORS = [
  { arrow: '→', walk: 'идёт вправо' },
  { arrow: '↑', walk: 'идёт вперёд' },
  { arrow: '←', walk: 'идёт влево' },
  { arrow: '↓', walk: 'идёт назад' },
]
/** Открой игру с ?debug — под мини-окном появятся замеры для подстройки порогов. */
const DEBUG = new URLSearchParams(location.search).has('debug')

function debugLine() {
  const l = control.hands.left
  const r = control.hands.right
  const h = control.head
  const parts = [
    l ? `левая ${l.fist ? 'кулак ✓' : 'открыта'}` : 'левая —',
    r ? `пальцы ${r.curls.map((c) => (c === 'curled' ? '●' : c === 'half' ? '◐' : '○')).join('')}` : '',
    h.visible ? `голова x${(h.x * 100).toFixed(0)} y${(h.y * 100).toFixed(0)} z${(h.z * 100).toFixed(0)} см` : 'лицо —',
  ]
  parts.push(poseDebug())
  parts.push(`распозн. ${control.tracking.inferMs.toFixed(0)} мс`)
  return parts.filter(Boolean).join(' · ')
}

/** Что делает левый кулак: двигает мир (поворот и наклон вместе), докручивает его сам или приближает. */
function describeGrab() {
  const v = control.view
  if (v.mode === 'zoom') return `Левая: зум ×${v.zoom.toFixed(1)}`
  if (v.rate > 0) return 'Левая: мир крутится сам'
  if (v.mode === 'move') return 'Левая: держишь мир'
  return 'Левая: кулак — веди или толкай'
}

/**
 * Зона левого кулака: круг вокруг места, где сжат кулак, — внутри мир едет за рукой; рука за кругом —
 * круг подсвечен в её сторону, мир докручивается сам. При зуме круг пунктиром.
 */
function drawGrabZone(ctx: CanvasRenderingContext2D, h: HandState, k: { x: number; y: number }) {
  const v = control.view
  const px = h.palm.x * W
  const py = h.palm.y * H
  if (v.edge > 0) {
    const ax = v.anchorX * W
    const ay = v.anchorY * H
    const rx = v.edge * k.x
    const ry = v.edge * k.y
    if (v.rate > 0) {
      const a = Math.atan2((py - ay) / ry, (px - ax) / rx)
      ctx.fillStyle = `rgba(46,196,182,${0.25 + 0.35 * v.rate})`
      ctx.beginPath()
      ctx.ellipse(ax, ay, rx * 1.35, ry * 1.35, 0, a - 0.6, a + 0.6)
      ctx.ellipse(ax, ay, rx, ry, 0, a + 0.6, a - 0.6, true)
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(46,196,182,0.9)'
    ctx.lineWidth = 2
    if (v.mode === 'zoom') ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.ellipse(ax, ay, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    if (v.mode !== 'zoom') {
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(px, py)
      ctx.stroke()
    }
  }
  ctx.fillStyle = COLORS.left
  ctx.strokeStyle = COLORS.cream
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(px, py, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function describe(h: HandState | null, side: 'left' | 'right') {
  if (!h) return side === 'right' ? 'Правая: нет' : 'Левая: нет'
  if (side === 'left') return h.fist ? describeGrab() : 'Левая: видна'
  if (h.fist) return 'Правая: кулак → прыжок'
  const j = control.joystick
  if (j.suspended) return 'Правая: видна'
  if (j.calibrating) return 'Правая: держи — ставлю круг'
  if (!j.armed) return 'Правая: заведи в жёлтый круг'
  if (runtime.moveLocked) return 'Правая: верни в круг'
  return j.sector >= 0 ? `Правая: ${SECTORS[j.sector].walk}` : 'Правая: стоп'
}

/** Кольцо ладони у лица: секторы, центр, стрелки. Радиусы — в долях высоты кадра, k — перевод в пиксели. */
function drawPalmRing(ctx: CanvasRenderingContext2D, k: { x: number; y: number }, t: number) {
  const j = control.joystick
  const cx = j.centerX * W
  const cy = j.centerY * H
  const full = { x: j.radius * k.x, y: j.radius * k.y }
  const dead = { x: j.deadRadius * k.x, y: j.deadRadius * k.y }
  const waiting = !j.armed || j.calibrating || runtime.moveLocked

  // Связь с лицом: пока рука не поднята, кольцо следует за лицом.
  const f = control.face.points
  if (j.faceAnchored && !j.armed && f.length >= 2) {
    ctx.strokeStyle = 'rgba(255,247,234,0.45)'
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(((f[0].x + f[1].x) / 2) * W, ((f[0].y + f[1].y) / 2) * H)
    ctx.lineTo(cx, cy)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Сектор, куда идём, — подсвечен.
  if (j.armed && j.sector >= 0 && !runtime.moveLocked) {
    const mid = (-j.sector * Math.PI) / 2
    ctx.fillStyle = 'rgba(255,90,95,0.45)'
    ctx.beginPath()
    ctx.ellipse(cx, cy, full.x, full.y, 0, mid - Math.PI / 4, mid + Math.PI / 4)
    ctx.ellipse(cx, cy, dead.x, dead.y, 0, mid + Math.PI / 4, mid - Math.PI / 4, true)
    ctx.closePath()
    ctx.fill()
  }

  // Внешнее кольцо и крест между секторами.
  ctx.strokeStyle = 'rgba(255,247,234,0.6)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(cx, cy, full.x, full.y, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,247,234,0.35)'
  ctx.beginPath()
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    ctx.moveTo(cx + Math.cos(a) * dead.x, cy + Math.sin(a) * dead.y)
    ctx.lineTo(cx + Math.cos(a) * full.x * 1.25, cy + Math.sin(a) * full.y * 1.25)
  }
  ctx.stroke()

  // Центр: жёлтый и пульсирует — «заведи ладонь сюда»; зелёный — готов.
  const color = waiting ? COLORS.wait : COLORS.ready
  ctx.globalAlpha = waiting ? 0.2 + 0.15 * Math.sin(t / 180) : 0.25
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(cx, cy, dead.x, dead.y, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5
  if (waiting) ctx.setLineDash([5, 4])
  ctx.stroke()
  ctx.setLineDash([])

  // Стрелки направлений посередине секторов.
  const r = { x: (full.x + dead.x) / 2, y: (full.y + dead.y) / 2 }
  ctx.font = '700 13px Onest, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(29,35,64,0.8)'
  SECTORS.forEach((s, i) => {
    const a = (-i * Math.PI) / 2
    const x = cx + Math.cos(a) * r.x
    const y = cy + Math.sin(a) * r.y
    ctx.fillStyle = i === j.sector && j.armed ? COLORS.cream : 'rgba(255,247,234,0.75)'
    ctx.strokeText(s.arrow, x, y)
    ctx.fillText(s.arrow, x, y)
  })
}

/** Ладонь-точка поверх скелета: к центру — пунктир «сюда», при ходьбе — «палка» от центра. */
function drawPalmDot(ctx: CanvasRenderingContext2D, h: HandState) {
  const j = control.joystick
  const px = h.palm.x * W
  const py = h.palm.y * H
  const cx = j.centerX * W
  const cy = j.centerY * H
  if (!j.armed && !j.calibrating) {
    ctx.strokeStyle = COLORS.wait
    ctx.setLineDash([3, 4])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(cx, cy)
    ctx.stroke()
    ctx.setLineDash([])
  } else if (j.armed && j.sector >= 0) {
    ctx.strokeStyle = COLORS.right
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(px, py)
    ctx.stroke()
  }
  ctx.fillStyle = COLORS.right
  ctx.strokeStyle = COLORS.cream
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(px, py, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

export function CameraPreview() {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [labels, setLabels] = useState({ left: '', right: '', fps: 0, debug: '' })
  const dpr = Math.min(2, window.devicePixelRatio || 1)

  // Настоящая высота угла (подписи переносятся по-разному) — чтобы на узком экране подсказки вставали над ним.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const css = document.documentElement.style
    const ro = new ResizeObserver(() => css.setProperty('--corner-h', `${Math.ceil(el.getBoundingClientRect().height)}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      css.removeProperty('--corner-h')
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let frame = 0
    let wasArmed = false
    const ctx = canvas.current?.getContext('2d')
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!ctx) return
      const now = performance.now()
      // Ладонь зашла в круг — тихий щелчок: «джойстик слушается».
      const armed = control.joystick.armed
      if (armed && !wasArmed) sfx.tick()
      wasArmed = armed
      const v = control.tracking.video
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (v && v.readyState >= 2) {
        ctx.save()
        ctx.translate(W, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(v, 0, 0, W, H)
        ctx.restore()
      }
      ctx.fillStyle = 'rgba(29,35,64,0.25)'
      ctx.fillRect(0, 0, W, H)

      // Лицо: мелкие точки контура и зрачки.
      ctx.fillStyle = 'rgba(255,247,234,0.85)'
      control.face.points.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(p.x * W, p.y * H, i < 2 ? 3 : 1.3, 0, Math.PI * 2)
        ctx.fill()
      })

      // Радиусы кольца — в долях высоты кадра; в пиксели по x — с поправкой на ширину кадра.
      const aspect = v && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3
      const k = { x: W / aspect, y: H }
      const j = control.joystick
      const palm = j.radius > 0 && !j.suspended

      const pulse = 3 + Math.sin(now / 120) * 1.5
      for (const side of ['left', 'right'] as const) {
        const h = control.hands[side]
        if (!h) continue
        const bad = new Set(control.hints.filter((x) => x.hand === side).flatMap((x) => x.landmarks ?? []))
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        for (const [a, b] of BONES) {
          ctx.strokeStyle = bad.has(a) && bad.has(b) ? COLORS.bad : COLORS[side]
          ctx.beginPath()
          ctx.moveTo(h.points[a].x * W, h.points[a].y * H)
          ctx.lineTo(h.points[b].x * W, h.points[b].y * H)
          ctx.stroke()
        }
        h.points.forEach((p, i) => {
          ctx.fillStyle = bad.has(i) ? COLORS.bad : COLORS.cream
          ctx.beginPath()
          ctx.arc(p.x * W, p.y * H, bad.has(i) ? pulse : 2.5, 0, Math.PI * 2)
          ctx.fill()
        })
        if (side === 'left' && h.fist) drawGrabZone(ctx, h, k)
      }

      // Кольцо — поверх скелета: ладонь почти всегда лежит на нём, и пальцы не должны его закрывать.
      if (palm) {
        drawPalmRing(ctx, k, now)
        if (control.hands.right) drawPalmDot(ctx, control.hands.right)
      }

      if (frame++ % 10 === 0) {
        setLabels({
          left: describe(control.hands.left, 'left'),
          right: describe(control.hands.right, 'right'),
          fps: Math.round(control.tracking.fps),
          debug: DEBUG ? debugLine() : '',
        })
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [dpr])

  return (
    <div ref={root} className="cam-preview">
      <canvas ref={canvas} width={W * dpr} height={H * dpr} />
      <div className="cam-preview__labels">
        <span className="tag tag--right">{labels.right}</span>
        <span className="tag tag--left">{labels.left}</span>
        <span className="cam-preview__fps">камера {labels.fps} к/с</span>
        {labels.debug && <span className="cam-preview__debug">{labels.debug}</span>}
      </div>
    </div>
  )
}
