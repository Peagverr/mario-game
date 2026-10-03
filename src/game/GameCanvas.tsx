import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Physics } from '@react-three/rapier'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, useEffect, useState } from 'react'
import { useGame } from '../shared/gameStore'
import { AtmosphereDriver } from './atmosphere/AtmosphereDriver'
import { Bursts, Lights, Sky } from './Environment'
import { palette } from './palette'
import { runtime } from './runtime'
import { SCENES } from './scenes'
import { SpiritDirector } from './spirit/SpiritDirector'
import { updateHaze } from './world/haze'
import { Mist } from './world/Mist'
import { WindowCamera } from './WindowCamera'

/**
 * Отладка (только с ?step в адресе): игра не крутится сама, кадры прокручиваются вручную ровными шагами —
 * window.__advance(кадров, шаг). Так физику можно проверить, даже когда вкладка скрыта и браузер не рисует кадры.
 */
const STEP_MODE = new URLSearchParams(location.search).has('step')
const HIGH_DPR = Math.min(window.devicePixelRatio || 1, 1.5)

function DebugStepper() {
  const advance = useThree((s) => s.advance)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  useEffect(() => void Object.assign(window, { __scene: scene, __camera: camera, __gl: gl }), [scene, camera, gl])
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

/** Дымка скал и башен теплеет в сторону солнца — обновляем её раз в кадр. */
function HazeDriver() {
  useFrame(({ camera }) => updateHaze(camera))
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
  // Чёткость как у экрана (не выше 1.5 — при отдалении камеры мелкие детали иначе «лесенкой»).
  // Если кадров мало, PerformanceMonitor опускает до 1, а на слабом ноутбуке — до 0.85.
  const [dpr, setDpr] = useState(HIGH_DPR)

  return (
    <Canvas
      shadows
      dpr={dpr}
      frameloop={STEP_MODE ? 'never' : 'always'}
      // В режиме ?step картинку не стирать после кадра — иначе скриншот ловит пустой холст.
      gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: STEP_MODE }}
      className="game-canvas"
    >
      {STEP_MODE && <DebugStepper />}
      <PerformanceMonitor
        onDecline={() => {
          // первый шаг — убрать сверхчёткость, второй — слабый режим
          setDpr((d) => {
            if (d > 1) return 1
            setQuality('low')
            runtime.lowQuality = true
            return 0.85
          })
        }}
        onIncline={() => setDpr((d) => (runtime.lowQuality ? d : HIGH_DPR))}
      />
      <fog attach="fog" args={[palette.skyBottom, 60, 170]} />
      {/* Время суток: ночь в лобби → рассвет на итогах; красит небо, свет, туман и облака. */}
      <AtmosphereDriver />
      <WindowCamera />
      <Sky />
      <Lights />
      {/* Море тумана под островами (вместо облаков-шаров). */}
      <Mist />
      <HazeDriver />
      <Suspense fallback={null}>
        <Physics gravity={[0, -24, 0]} paused={phase === 'paused'} timeStep="vary">
          <Scene key={`${sceneId}-${runId}`} />
        </Physics>
      </Suspense>
      <Bursts />
      {/* Дух Окна — у героя во всех сценах (вид — spirit/, поведение обучения — spiritState). */}
      <SpiritDirector />
      <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
        <Bloom mipmapBlur resolutionScale={0.5} luminanceThreshold={0.85} intensity={quality === 'high' ? 0.7 : 0.4} />
        <Vignette offset={0.25} darkness={0.45} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  )
}
