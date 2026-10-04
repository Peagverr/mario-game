import { useEffect } from 'react'
import { GameCanvas } from './game/GameCanvas'
import { control } from './shared/controlState'
import { useGame } from './shared/gameStore'
import { CameraLost, useCameraPause } from './ui/CameraLost'
import { CameraPreview } from './ui/CameraPreview'
import { HandCursor } from './ui/Dwell'
import { Hints } from './ui/Hints'
import { MenuHoldRing } from './ui/MenuHoldRing'
import { Countdown, HUD, PauseMenu } from './ui/Overlays'
import { PalmPad } from './ui/PalmPad'
import { Results } from './ui/Results'
import { StartScreen } from './ui/StartScreen'
import { Tutorial } from './ui/Tutorial'
import { VoiceDirector } from './ui/VoiceDirector'

/** Жест «две ладони» переключает паузу. */
function usePauseGesture() {
  useEffect(() => {
    let raf = 0
    let seen = control.pauseSeq
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (control.pauseSeq === seen) return
      seen = control.pauseSeq
      const g = useGame.getState()
      if (g.phase === 'playing') g.pause('menu')
      else if (g.phase === 'paused' && g.pauseReason === 'menu') g.setPhase('playing')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}

export function App() {
  const phase = useGame((s) => s.phase)
  const pauseReason = useGame((s) => s.pauseReason)
  usePauseGesture()
  useCameraPause()

  const inGame = phase !== 'start' && phase !== 'loading'
  const playable = phase === 'playing' || phase === 'tutorial' || phase === 'countdown'
  const menuOpen = phase === 'paused' || phase === 'results'
  const cursor = menuOpen || phase === 'tutorial'

  return (
    // В меню и на итогах таблички 3D-мира скрыты — ничего не лезет поверх меню.
    <div className={menuOpen ? 'app app--menu' : 'app'}>
      <GameCanvas />
      <VoiceDirector />
      {phase === 'start' && <StartScreen />}
      {phase === 'tutorial' && <Tutorial />}
      {phase === 'countdown' && <Countdown />}
      {phase === 'playing' && <HUD />}
      {phase === 'paused' && pauseReason === 'menu' && <PauseMenu />}
      {/* Поверх меню: камера пропала — пока её нет, меню всё равно не нажать. */}
      {phase === 'paused' && <CameraLost />}
      {phase === 'results' && <Results />}
      {inGame && control.tracking.ready && <CameraPreview />}
      {/* Большой джойстик справа внизу: сам прячется, пока круга нет (камера не запущена) или открывается меню. */}
      {playable && <PalmPad />}
      {playable && <Hints />}
      {(phase === 'playing' || phase === 'tutorial') && <MenuHoldRing />}
      {cursor && <HandCursor />}
    </div>
  )
}
