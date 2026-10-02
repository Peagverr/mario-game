import { useState } from 'react'
import { unlockAudio } from '../game/sfx'
import { preloadVoice } from '../game/voice'
import { enableDevKeyboard } from '../input/keyboardDev'
import { startTracking, type TrackerStatus } from '../input/tracker'
import { useGame } from '../shared/gameStore'

type State = { kind: 'idle' } | { kind: 'loading'; step: TrackerStatus } | { kind: 'error'; text: string }

function explain(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (!window.isSecureContext) return 'Камера работает только по защищённой ссылке (https). Открой игру по ссылке из README.'
  if (name === 'NotAllowedError') return 'Доступ к камере запрещён. Нажми на значок камеры в адресной строке → «Разрешить» и обнови страницу.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена. Подключи веб-камеру или открой игру на ноутбуке с камерой.'
  if (name === 'NotReadableError') return 'Камера занята другой программой (Zoom, Telegram, OBS). Закрой её и попробуй снова.'
  return 'Не удалось загрузить нейросети распознавания. Проверь интернет и обнови страницу.'
}

export function StartScreen() {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const start = async () => {
    unlockAudio()
    preloadVoice()
    try {
      await startTracking((step) => setState({ kind: 'loading', step }))
      useGame.getState().setPhase('tutorial')
    } catch (e) {
      console.error(e)
      setState({ kind: 'error', text: explain(e) })
    }
  }

  const devStart = () => {
    unlockAudio()
    preloadVoice()
    enableDevKeyboard()
    useGame.getState().setPhase('tutorial')
  }

  return (
    <div className="screen screen--start">
      <div className="card card--hero">
        <p className="eyebrow">Admit Hackathon · кейс Motion</p>
        <h1 className="title">Окно</h1>
        <p className="lead">
          Экран станет окном в маленький парящий мир. Двигай головой — заглядывай внутрь. Правой ладонью у лица веди
          героя, кулаком — прыгай, щипком левой — поворачивай мир.
        </p>

        {state.kind === 'idle' && (
          <>
            <button className="big-btn" onClick={start}>
              Включить камеру и играть
            </button>
            <p className="fine">
              Видео с камеры обрабатывается прямо в браузере и никуда не отправляется. Это единственный клик — дальше
              всё управляется руками и головой.
            </p>
          </>
        )}

        {state.kind === 'loading' && (
          <div className="loading">
            <span className="spinner" />
            {state.step === 'camera' && 'Включаем камеру — разреши доступ в окне браузера…'}
            {state.step === 'models' && 'Загружаем нейросети распознавания (~15 МБ, один раз)…'}
            {state.step === 'ready' && 'Готово!'}
          </div>
        )}

        {state.kind === 'error' && (
          <div className="error-box">
            <p>{state.text}</p>
            <button className="big-btn" onClick={start}>
              Попробовать снова
            </button>
          </div>
        )}

        {import.meta.env.DEV && (
          <button className="dev-btn" onClick={devStart}>
            [dev] без камеры — клавиатура
          </button>
        )}
      </div>

      <ul className="how">
        <li><b>Голова</b> — эффект окна</li>
        <li><b>Правая ладонь у лица</b> — ходьба</li>
        <li><b>Кулак</b> — прыжок</li>
        <li><b>Левый кулак</b> — повернуть и приблизить мир</li>
        <li><b>Две ладони</b> — пауза</li>
      </ul>
    </div>
  )
}
