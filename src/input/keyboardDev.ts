import { control } from '../shared/controlState'

/**
 * Управление с клавиатуры — ТОЛЬКО в режиме разработки (`npm run dev`).
 * В собранной версии для жюри этот код не подключается (ТЗ: без клавиатуры и мыши).
 *
 * WASD — ходьба · Пробел — прыжок · Q/E — повернуть мир · Z/X — зум
 * Стрелки — «сдвинуть голову» (проверить эффект окна) · P — пауза
 */
export function enableDevKeyboard() {
  if (!import.meta.env.DEV) return
  control.devKeyboard = true
  const down = new Set<string>()
  const head = { x: 0, y: 0 }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return
    down.add(e.code)
    if (e.code === 'Space') control.jumpSeq++
    if (e.code === 'KeyP') control.pauseSeq++
  })
  window.addEventListener('keyup', (e) => down.delete(e.code))

  let last = performance.now()
  const tick = () => {
    requestAnimationFrame(tick)
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    if (down.size === 0) return

    const k = (c: string) => (down.has(c) ? 1 : 0)
    const mx = k('KeyD') - k('KeyA')
    const my = k('KeyW') - k('KeyS')
    if (mx || my) {
      control.move.x = mx
      control.move.y = my
    } else if (!control.hands.right) {
      control.move.x = 0
      control.move.y = 0
    }
    control.view.yaw += (k('KeyE') - k('KeyQ')) * dt * 1.5
    control.view.zoom = Math.min(1.8, Math.max(0.6, control.view.zoom + (k('KeyZ') - k('KeyX')) * dt))

    const hx = k('ArrowRight') - k('ArrowLeft')
    const hy = k('ArrowUp') - k('ArrowDown')
    if (hx || hy) {
      head.x = Math.max(-0.25, Math.min(0.25, head.x + hx * dt * 0.3))
      head.y = Math.max(-0.2, Math.min(0.2, head.y + hy * dt * 0.3))
      control.head.x = head.x
      control.head.y = head.y
      control.head.z = 0.6
      control.head.visible = true
    }
  }
  // Отпускание клавиш ходьбы должно останавливать героя.
  window.addEventListener('keyup', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) && !control.hands.right) {
      control.move.x = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0)
      control.move.y = (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0)
    }
  })
  requestAnimationFrame(tick)
}
