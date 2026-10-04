import { describe, expect, it } from 'vitest'
import { follow, ROTATE_SMOOTH_S } from './viewSmoothing'

/** Разброс шага от кадра к кадру: 0 — идеально ровно, 1 — шаг «скачет» на свою величину. */
function unevenness(steps: number[]) {
  const mean = steps.reduce((s, x) => s + x, 0) / steps.length
  const sd = Math.sqrt(steps.reduce((s, x) => s + (x - mean) ** 2, 0) / steps.length)
  return sd / mean
}

/**
 * Игрок ровно поворачивает мир кулаком (1 рад/с). Трекер обновляет угол с частотой камеры (60 Гц),
 * экран рисует 165 Гц, и кадры неровные (6, 6, 12, 6, 18 мс — так их делит с трекером главный поток).
 */
function simulate(smooth: boolean) {
  const frameMs = [6, 6, 12, 6, 18, 6, 6, 12]
  let t = 0
  let target = 0
  let nextCamera = 0
  let shown = 0
  const steps: number[] = []
  for (let i = 0; i < 600; i++) {
    const dt = frameMs[i % frameMs.length] / 1000
    t += dt
    while (nextCamera <= t) {
      target = nextCamera // 1 рад/с: угол = время кадра камеры
      nextCamera += 1 / 60
    }
    const prev = shown
    shown = smooth ? follow(shown, target, dt, ROTATE_SMOOTH_S) : target
    // Глаз оценивает скорость: шаг угла за кадр, делённый на длительность кадра.
    if (i > 100) steps.push((shown - prev) / dt)
  }
  return { steps, lag: target - shown }
}

describe('сглаживание поворота мира', () => {
  it('без сглаживания мир вращается рывками: в части кадров стоит, в части прыгает', () => {
    const raw = simulate(false)
    expect(raw.steps.filter((s) => s === 0).length).toBeGreaterThan(raw.steps.length / 3)
    expect(unevenness(raw.steps)).toBeGreaterThan(0.7)
  })

  it('со сглаживанием скорость поворота ровная, даже когда кадры неровные', () => {
    const smooth = simulate(true)
    expect(smooth.steps.every((s) => s > 0)).toBe(true)
    expect(unevenness(smooth.steps)).toBeLessThan(0.25)
  })

  it('запаздывание небольшое: при повороте 1 рад/с мир отстаёт от руки меньше чем на 0.1 рад (~6°)', () => {
    expect(simulate(true).lag).toBeLessThan(0.1)
  })

  it('отпустил кулак — мир доезжает до места руки за долю секунды и не проскакивает', () => {
    let v = 0
    let max = 0
    for (let i = 0; i < 60; i++) {
      v = follow(v, 1, 1 / 165, ROTATE_SMOOTH_S)
      max = Math.max(max, v)
    }
    expect(v).toBeGreaterThan(0.99)
    expect(max).toBeLessThanOrEqual(1)
  })

  it('длинный кадр (подвисание) не перебрасывает мир дальше руки', () => {
    expect(follow(0, 1, 0.5, ROTATE_SMOOTH_S)).toBeLessThanOrEqual(1)
    expect(follow(0, 1, 0.5, ROTATE_SMOOTH_S)).toBeGreaterThan(0.9)
  })
})
