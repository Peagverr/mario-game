import { useEffect, useRef, useState } from 'react'
import { sfx } from '../game/sfx'
import { calibrateJoystick } from '../input/tracker'
import { control } from '../shared/controlState'
import { useGame } from '../shared/gameStore'
import { DwellButton } from './Dwell'

/**
 * Обучение = калибровка. Каждый шаг ждёт, пока игрок правильно выполнит жест,
 * и сразу показывает подсказки «режима ошибки», если что-то не так.
 */

type Step = {
  id: string
  title: string
  text: string
  /** Проверка каждый кадр; вернуть 0..1 — прогресс шага. */
  check: (ctx: StepCtx, dt: number) => number
  onDone?: () => void
}

type StepCtx = { acc: number; start: { jumpSeq: number; yaw: number; headX: number } }

const hold = (cond: boolean, ctx: StepCtx, dt: number, ms: number) => {
  ctx.acc = cond ? ctx.acc + dt : Math.max(0, ctx.acc - dt * 2)
  return Math.min(1, ctx.acc / ms)
}

const STEPS: Step[] = [
  {
    id: 'face',
    title: 'Сядь напротив камеры',
    text: 'Примерно на расстоянии вытянутой руки, лицо — в мини-окне слева внизу.',
    check: (c, dt) =>
      hold((control.head.visible && control.head.z > 0.33 && control.head.z < 1.15) || control.devKeyboard, c, dt, 800),
  },
  {
    id: 'palm',
    title: 'Подними правую ладонь',
    text: 'На уровне груди, пальцы вверх. Держи — здесь будет центр джойстика.',
    check: (c, dt) => hold(!!control.hands.right?.openPalm || control.devKeyboard, c, dt, 1000),
    onDone: calibrateJoystick,
  },
  {
    id: 'move',
    title: 'Сдвинь ладонь в сторону',
    text: 'Герой пойдёт туда, куда сдвинута ладонь. Чуть-чуть — хватит пары сантиметров.',
    check: (c, dt) => hold(Math.hypot(control.move.x, control.move.y) > 0.5, c, dt, 1200),
  },
  {
    id: 'jump',
    title: 'Сожми кулак',
    text: 'Кулак правой руки — прыжок. Разожми и сожми снова, чтобы прыгнуть ещё раз.',
    check: (c) => (control.jumpSeq !== c.start.jumpSeq ? 1 : 0),
  },
  {
    id: 'grab',
    title: 'Щипок левой рукой',
    text: 'Соедини большой и указательный и веди руку в сторону — мир повернётся. К камере — приблизится.',
    check: (c) => Math.min(1, Math.abs(control.view.yaw - c.start.yaw) / 0.6),
  },
  {
    id: 'head',
    title: 'Подвигай головой',
    text: 'Влево-вправо, вверх-вниз. Экран — окно: загляни в мир сбоку.',
    check: (c) => Math.min(1, Math.abs(control.head.x - c.start.headX) / 0.05),
  },
]

export function Tutorial() {
  const [index, setIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const ctx = useRef<StepCtx>({ acc: 0, start: { jumpSeq: 0, yaw: 0, headX: 0 } })
  const step = STEPS[index]

  useEffect(() => {
    if (!step) return
    ctx.current = {
      acc: 0,
      start: { jumpSeq: control.jumpSeq, yaw: control.view.yaw, headX: control.head.x },
    }
    let raf = 0
    let last = performance.now()
    let frame = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const p = step.check(ctx.current, now - last)
      last = now
      if (frame++ % 4 === 0) setProgress(p)
      if (p >= 1) {
        cancelAnimationFrame(raf)
        step.onDone?.()
        sfx.confirm()
        setProgress(1)
        setTimeout(() => {
          setProgress(0)
          setIndex((i) => i + 1)
        }, 450)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [step])

  useEffect(() => {
    if (index >= STEPS.length) {
      const t = setTimeout(() => useGame.getState().setPhase('countdown'), 900)
      return () => clearTimeout(t)
    }
  }, [index])

  return (
    <div className="tutorial">
      <div className="card card--tutorial">
        <div className="steps">
          {STEPS.map((s, i) => (
            <span key={s.id} className={`steps__dot ${i < index ? 'is-done' : i === index ? 'is-active' : ''}`} />
          ))}
        </div>
        {step ? (
          <>
            <p className="eyebrow">
              Шаг {index + 1} из {STEPS.length}
            </p>
            <h2 className="tutorial__title">{step.title}</h2>
            <p className="tutorial__text">{step.text}</p>
            <div className="bar">
              <div className="bar__fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        ) : (
          <h2 className="tutorial__title">Отлично! Поехали</h2>
        )}
      </div>
      {step && (
        <div className="tutorial__skip">
          <DwellButton variant="ghost" onActivate={() => useGame.getState().setPhase('countdown')}>
            Пропустить обучение
          </DwellButton>
        </div>
      )}
    </div>
  )
}
