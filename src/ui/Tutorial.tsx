import { useEffect, useRef, useState } from 'react'
import { sfx } from '../game/sfx'
import { beginJoystickCalibration, calibrateJoystick, endJoystickCalibration } from '../input/tracker'
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

type StepCtx = { acc: number; start: { jumpSeq: number; yaw: number; pitch: number; headX: number; pauseSeq: number } }

const hold = (cond: boolean, ctx: StepCtx, dt: number, ms: number) => {
  ctx.acc = cond ? ctx.acc + dt : Math.max(0, ctx.acc - dt * 2)
  return Math.min(1, ctx.acc / ms)
}

const STEPS: Step[] = [
  {
    // Калибровка: там, где руке удобно, встанет круг-джойстик. Круг ставится относительно лица —
    // поэтому ждём, чтобы и лицо было в кадре (отдельный шаг «сядь напротив камеры» больше не нужен).
    id: 'palm',
    title: 'Подними правую ладонь',
    text: 'Сядь напротив камеры и подними правую ладонь справа от лица, где руке удобно. Подержи секунду: там встанет круг-джойстик (он виден в окне камеры слева внизу).',
    check: (c, dt) => hold((!!control.hands.right?.openPalm && control.head.visible) || control.devKeyboard, c, dt, 1000),
    onDone: calibrateJoystick,
  },
  {
    id: 'move',
    title: 'Сдвинь ладонь из круга',
    text: 'Ладонь в круге — стоишь. Сдвинь её: вверх — вперёд, вниз — назад, в стороны — вбок. Вернул в круг — стоп.',
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
    text: 'Соедини большой и указательный и веди руку куда угодно: мир крутится и наклоняется, как будто держишь его. Руку к камере или от неё: приблизить или отдалить.',
    check: (c) =>
      Math.min(1, Math.max(Math.abs(control.view.yaw - c.start.yaw) / 0.6, Math.abs(control.view.pitch - c.start.pitch) / 0.3)),
  },
  {
    id: 'head',
    title: 'Подвигай головой',
    text: 'Влево-вправо, вверх-вниз. Экран — окно: загляни в мир сбоку.',
    check: (c) => Math.min(1, Math.abs(control.head.x - c.start.headX) / 0.05),
  },
  {
    id: 'menu',
    title: 'Две ладони — меню',
    text: 'Раскрой обе ладони и подержи секунду — откроется меню: пауза, заново, лобби, размер и место круга.',
    check: (c) => (control.pauseSeq !== c.start.pauseSeq ? 1 : Math.max(control.menuHold * 0.95, control.devKeyboard ? 1 : 0)),
  },
]

export function Tutorial() {
  const [index, setIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const ctx = useRef<StepCtx>({ acc: 0, start: { jumpSeq: 0, yaw: 0, pitch: 0, headX: 0, pauseSeq: 0 } })
  const step = STEPS[index]

  // Пока не дошли до шага «иди», кольцо ладони следует за рукой и герой стоит:
  // иначе рука, поднятая для калибровки, могла бы увести героя в портал лобби.
  useEffect(() => {
    beginJoystickCalibration()
    return endJoystickCalibration
  }, [])

  useEffect(() => {
    if (!step) return
    ctx.current = {
      acc: 0,
      start: { jumpSeq: control.jumpSeq, yaw: control.view.yaw, pitch: control.view.pitch, headX: control.head.x, pauseSeq: control.pauseSeq },
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
      // Обучение проходит в лобби — после него сразу можно идти к порталам.
      const t = setTimeout(() => useGame.getState().setPhase('playing'), 900)
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
          <DwellButton variant="ghost" onActivate={() => useGame.getState().setPhase('playing')}>
            Пропустить обучение
          </DwellButton>
        </div>
      )}
    </div>
  )
}
