import { useEffect, useRef, useState } from 'react'
import { control, type HandState } from '../shared/controlState'

/**
 * Мини-окно с камерой и скелетом — обратная связь «система тебя видит».
 * Цвета: правая рука — коралловая (джойстик и прыжок), левая — бирюзовая (поворот мира).
 * Точки, на которые указывает подсказка «режима ошибки», подсвечиваются красным и пульсируют.
 */

const W = 256
const H = 192
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
const COLORS = { right: '#ff5a5f', left: '#2ec4b6', bad: '#ff2d2d' }
/** Открой игру с ?debug — под мини-окном появятся замеры для подстройки порогов. */
const DEBUG = new URLSearchParams(location.search).has('debug')

function debugLine() {
  const l = control.hands.left
  const r = control.hands.right
  const h = control.head
  const parts = [
    l ? `щипок ${l.pinchRatio.toFixed(2)}${l.pinching ? ' ✓' : ''}` : 'щипок —',
    r ? `пальцы ${r.curls.map((c) => (c === 'curled' ? '●' : c === 'half' ? '◐' : '○')).join('')}` : '',
    h.visible ? `голова x${(h.x * 100).toFixed(0)} y${(h.y * 100).toFixed(0)} z${(h.z * 100).toFixed(0)} см` : 'лицо —',
  ]
  parts.push(`распозн. ${control.tracking.inferMs.toFixed(0)} мс`)
  return parts.filter(Boolean).join(' · ')
}

function describe(h: HandState | null, side: 'left' | 'right') {
  if (!h) return side === 'right' ? 'Правая: нет' : 'Левая: нет'
  if (side === 'right') return h.fist ? 'Правая: кулак → прыжок' : h.openPalm ? 'Правая: ладонь → ходьба' : 'Правая: видна'
  return h.pinching ? 'Левая: щипок → поворот' : 'Левая: видна'
}

export function CameraPreview() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [labels, setLabels] = useState({ left: '', right: '', fps: 0, debug: '' })

  useEffect(() => {
    let raf = 0
    let frame = 0
    const ctx = canvas.current?.getContext('2d')
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!ctx) return
      const v = control.tracking.video
      ctx.save()
      ctx.clearRect(0, 0, W, H)
      if (v && v.readyState >= 2) {
        ctx.translate(W, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(v, 0, 0, W, H)
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(29,35,64,0.25)'
      ctx.fillRect(0, 0, W, H)

      // Лицо: мелкие точки контура и зрачки.
      ctx.fillStyle = 'rgba(255,247,234,0.85)'
      control.face.points.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(p.x * W, p.y * H, i < 2 ? 3 : 1.3, 0, Math.PI * 2)
        ctx.fill()
      })

      // Центр джойстика и рабочая зона: видно, где «ноль» и насколько сдвинута рука.
      const j = control.joystick
      if (j.radius > 0 && control.scheme !== 'pointer') {
        const cx = j.centerX * W
        const cy = j.centerY * H
        if (j.faceAnchored && control.face.points.length) {
          const f = control.face.points
          ctx.strokeStyle = 'rgba(255,247,234,0.5)'
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(((f[0].x + f[1].x) / 2) * W, ((f[0].y + f[1].y) / 2) * H)
          ctx.lineTo(cx, cy)
          ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.strokeStyle = '#ffd23f'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.ellipse(cx, cy, j.radius * W, j.radius * H, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ffd23f'
        ctx.beginPath()
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      const pulse = 3 + Math.sin(performance.now() / 120) * 1.5
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
          ctx.fillStyle = bad.has(i) ? COLORS.bad : '#fff7ea'
          ctx.beginPath()
          ctx.arc(p.x * W, p.y * H, bad.has(i) ? pulse : 2.5, 0, Math.PI * 2)
          ctx.fill()
        })
        if (side === 'left' && h.pinching) {
          const m = { x: (h.points[4].x + h.points[8].x) / 2, y: (h.points[4].y + h.points[8].y) / 2 }
          ctx.strokeStyle = COLORS.left
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(m.x * W, m.y * H, 9, 0, Math.PI * 2)
          ctx.stroke()
        }
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
  }, [])

  return (
    <div className="cam-preview">
      <canvas ref={canvas} width={W} height={H} />
      <div className="cam-preview__labels">
        <span className="tag tag--right">{labels.right}</span>
        <span className="tag tag--left">{labels.left}</span>
        <span className="cam-preview__fps">камера {labels.fps} к/с</span>
        {labels.debug && <span className="cam-preview__debug">{labels.debug}</span>}
      </div>
    </div>
  )
}
