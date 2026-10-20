import { useState } from 'react'
import { t, useLang, useT, type Lang } from '../i18n'
import { unlockAudio } from '../game/sfx'
import { preloadVoice } from '../game/voice'
import { enableDevKeyboard } from '../input/keyboardDev'
import { startTracking, type TrackerStatus } from '../input/tracker'
import { useGame } from '../shared/gameStore'

type State = { kind: 'idle' } | { kind: 'loading'; step: TrackerStatus } | { kind: 'error'; text: ErrorKey }

type ErrorKey = 'errInsecure' | 'errDenied' | 'errNotFound' | 'errBusy' | 'errModels'

function explain(e: unknown): ErrorKey {
  const name = (e as { name?: string })?.name
  if (!window.isSecureContext) return 'errInsecure'
  if (name === 'NotAllowedError') return 'errDenied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'errNotFound'
  if (name === 'NotReadableError') return 'errBusy'
  return 'errModels'
}

const LANGS: Lang[] = ['en', 'ru']

/** EN / RU: на стартовом экране ещё работает мышь. */
function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l} className={l === lang ? 'is-on' : ''} aria-pressed={l === lang} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function StartScreen() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const s = useT().start

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
        <LangSwitch />
        <p className="eyebrow">{s.eyebrow}</p>
        <h1 className="title">{t().name}</h1>
        <p className="lead">{s.lead}</p>

        {state.kind === 'idle' && (
          <>
            <button className="big-btn" onClick={start}>
              {s.play}
            </button>
            <p className="fine">{s.privacy}</p>
          </>
        )}

        {state.kind === 'loading' && (
          <div className="loading">
            <span className="spinner" />
            {state.step === 'camera' && s.loadingCamera}
            {state.step === 'models' && s.loadingModels}
            {state.step === 'ready' && s.ready}
          </div>
        )}

        {state.kind === 'error' && (
          <div className="error-box">
            <p>{s[state.text]}</p>
            <button className="big-btn" onClick={start}>
              {s.retry}
            </button>
          </div>
        )}

        {import.meta.env.DEV && (
          <button className="dev-btn" onClick={devStart}>
            {s.dev}
          </button>
        )}
      </div>

      <ul className="how">
        {s.how.map(([bold, rest]) => (
          <li key={bold}><b>{bold}</b>{rest}</li>
        ))}
      </ul>
    </div>
  )
}
