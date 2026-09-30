import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Physics } from '@react-three/rapier'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, useEffect, useState } from 'react'
import { useGame } from '../shared/gameStore'
import { Bursts, Clouds, Lights, Sky } from './Environment'
import { palette } from './palette'
import { SCENES } from './scenes'
import { WindowCamera } from './WindowCamera'

/**
 * Отладка (только с ?step в адресе): игра не крутится сама, кадры прокручиваются вручную ровными шагами —
 * window.__advance(кадров, шаг). Так физику можно проверить, даже когда вкладка скрыта и браузер не рисует кадры.
 */
const STEP_MODE = new URLSearchParams(location.search).has('step')

function DebugStepper() {
  const advance = useThree((s) => s.advance)
  useEffect(() => {
    let t = 0
    Object.assign(window, {
      __advance: (frames = 1, dt = 1 / 60) => {
        for (let i = 0; i < frames; i++) {
          t += dt
          advance(t)
        }
      },
    })
  }, [advance])
  return null
}

/**
 * 3D-сцена целиком: камера-«окно», свет, небо, физика, текущий уровень и постобработка.
 * Качество само снижается, если кадров в секунду мало (слабый ноутбук у жюри).
 */
export function GameCanvas() {
  const phase = useGame((s) => s.phase)
  const runId = useGame((s) => s.runId)
  const sceneId = useGame((s) => s.sceneId)
  const Scene = SCENES[sceneId] ?? SCENES.lobby!
  const [quality, setQuality] = useState<'high' | 'low'>('high')
  const [dpr, setDpr] = useState(1.25)

  return (
    <Canvas
      shadows
      dpr={dpr}
      frameloop={STEP_MODE ? 'never' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      className="game-canvas"
    >
      {STEP_MODE && <DebugStepper />}
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1)
          setQuality('low')
        }}
        onIncline={() => setDpr(1.25)}
      />
      <fog attach="fog" args={[palette.skyBottom, 60, 170]} />
      <WindowCamera />
      <Sky />
      <Lights />
      <Clouds />
      <Suspense fallback={null}>
        <Physics gravity={[0, -24, 0]} paused={phase === 'paused'} timeStep="vary">
          <Scene key={`${sceneId}-${runId}`} />
        </Physics>
      </Suspense>
      <Bursts />
      <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
        <Bloom mipmapBlur luminanceThreshold={0.85} intensity={quality === 'high' ? 0.7 : 0.4} />
        <Vignette offset={0.25} darkness={0.45} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  )
}
