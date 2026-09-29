import { PerformanceMonitor } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Physics } from '@react-three/rapier'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, useState } from 'react'
import { useGame } from '../shared/gameStore'
import { Bursts, Clouds, Lights, Sky } from './Environment'
import { palette } from './palette'
import { SCENES } from './scenes'
import { WindowCamera } from './WindowCamera'

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
    <Canvas shadows dpr={dpr} gl={{ antialias: false, powerPreference: 'high-performance' }} className="game-canvas">
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
