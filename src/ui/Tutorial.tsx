import { useEffect, useRef, useState } from 'react'
import { hideHolo, matchHolo, showHolo } from '../game/holo/holoCue'
import { sfx } from '../game/sfx'
import { PRIORITY, say, voiceBusy } from '../game/voice'
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
  /** Реплика голоса в начале шага и когда шаг выполнен. */
  voice?: string
  /** Реплика перед voice (очередь голоса ставит их друг за другом). */
  voicePre?: string
  voiceDone?: string
  /** Клип голограммы-подсказки рядом с героем; шаг выполнен — голограмма рассыпается. */
  holo?: string
}

type StepCtx = { acc: number; start: { jumpSeq: number; yaw: number; pitch: number; headX: number; pauseSeq: number } }

/** Голограмма руки в обучении выключена: вместо неё будет дух-компаньон (src/game/spirit). Код и запись жестов (`?record`) остаются. */
const SHOW_HOLO_HAND = false

/** Дольше этого обучение не ждёт, пока Окно договорит (мс). */
const VOICE_WAIT_MAX_MS = 5000
/** Столько держать ладонь в центре джойстика, чтобы шаг засчитался: мимолётное касание — не «понял». */
const PALM_HOLD_MS = 700

const hold = (cond: boolean, ctx: StepCtx, dt: number, ms: number) => {
  ctx.acc = cond ? ctx.acc + dt : Math.max(0, ctx.acc - dt * 2)
  return Math.min(1, ctx.acc / ms)
}

const STEPS: Step[] = [
  {
    // Круг-джойстик уже стоит справа внизу (в кадре и на экране) — калибровать ничего не нужно:
    // ладонь зашла в центр и задержалась там — джойстик готов, герой слушается.
    id: 'palm',
    title: 'Заведи ладонь в круг',
    text: 'Подними правую ладонь низко справа — локоть можно опереть на стол — и заведи её в жёлтый центр джойстика справа внизу. Задержи там.',
    check: (c, dt) =>
      hold((control.joystick.armed && control.joystick.sector < 0) || control.devKeyboard, c, dt, PALM_HOLD_MS),
    holo: 'palm-raise',
    // «Камера включена. Я тебя вижу» звучит при входе в обучение (VoiceDirector), затем «Я — Окно…», затем инструкция.
    voicePre: 'awake.intro',
    voice: 'walk.raise',
    voiceDone: 'walk.contact',
  },
  {
    id: 'move',
    title: 'Сдвинь ладонь из центра',
    text: 'Ладонь в центре — стоишь. Сдвинь её: вверх — вперёд, вниз — назад, в стороны — вбок. Вернул в центр — стоп.',
    check: (c, dt) => hold(Math.hypot(control.move.x, control.move.y) > 0.5, c, dt, 1200),
    holo: 'palm-move',
    voice: 'walk.move',
    voiceDone: 'walk.good',
  },
  {
    id: 'jump',
    title: 'Сожми кулак',
    text: 'Кулак правой руки — прыжок. Разожми и сожми снова, чтобы прыгнуть ещё раз.',
    check: (c) => (control.jumpSeq !== c.start.jumpSeq ? 1 : 0),
    holo: 'fist',
    voice: 'jump.teach',
    voiceDone: 'jump.ok',
  },
  {
    id: 'grab',
    title: 'Сожми левый кулак',
    text: 'Левый кулак держит мир: веди его куда угодно — мир крутится и наклоняется. Уведи дальше бирюзового круга — мир будет крутиться сам. Кулак к камере или от неё — приблизить или отдалить. Разжал — отпустил.',
    check: (c) =>
      Math.min(1, Math.max(Math.abs(control.view.yaw - c.start.yaw) / 0.6, Math.abs(control.view.pitch - c.start.pitch) / 0.3)),
    // Своей реплики «сожми левый кулак» пока нет — голос только хвалит, когда получилось.
    voiceDone: 'short.clean',
  },
  {
    id: 'head',
    title: 'Подвигай головой',
    text: 'Влево-вправо, вверх-вниз. Экран — окно: загляни в мир сбоку.',
    check: (c) => Math.min(1, Math.abs(control.head.x - c.start.headX) / 0.05),
    voice: 'window.head',
    voiceDone: 'short.exact',
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
  const current = useRef(step)
  current.current = step

  useEffect(() => hideHolo, [])

  useEffect(() => {
    if (!step) return
    ctx.current = {
      acc: 0,
      start: { jumpSeq: control.jumpSeq, yaw: control.view.yaw, pitch: control.view.pitch, headX: control.head.x, pauseSeq: control.pauseSeq },
    }
    if (SHOW_HOLO_HAND && step.holo) showHolo(step.holo)
    else hideHolo()
    // Шаг уже выполнили, пока голос договаривал прошлое, — инструкция к нему больше не нужна.
    if (step.voicePre) say(step.voicePre, { priority: PRIORITY.story, waitMs: 6000 })
    if (step.voice) say(step.voice, { priority: PRIORITY.story, waitMs: 6000, valid: () => current.current === step })
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
        if (SHOW_HOLO_HAND && step.holo) matchHolo()
        sfx.confirm()
        if (step.voiceDone) say(step.voiceDone, { priority: PRIORITY.story, waitMs: 8000 })
        setProgress(1)
        // Следующий шаг — когда Окно договорило (но не дольше VOICE_WAIT_MAX_MS): инструкции не налезают друг на друга.
        const doneAt = now
        const next = () => {
          const waited = performance.now() - doneAt
          if (waited >= 450 && (!voiceBusy() || waited > VOICE_WAIT_MAX_MS)) {
            setProgress(0)
            setIndex((i) => i + 1)
          } else timer = window.setTimeout(next, 100)
        }
        timer = window.setTimeout(next, 450)
      }
    }
    let timer = 0
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
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
