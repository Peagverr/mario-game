import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Physics } from '@react-three/rapier'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useGame } from '../shared/gameStore'
import { AtmosphereDriver } from './atmosphere/AtmosphereDriver'
import { Bursts, Lights, Sky } from './Environment'
import { palette } from './palette'
import { QUALITY_FLIPFLOPS, qualityBounds, qualityLevels, stepQuality } from './quality'
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
 * Плотность пикселей экрана. Она меняется, если окно перетащили на другой монитор (ноутбук 1.5× → проектор 1×)
 * или поменяли масштаб (Ctrl +/−): раньше её брали один раз при загрузке — и до перезагрузки было мыло.
 */
function useDeviceDpr() {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])
  return dpr
}

/** Кадры рендера в секунду — для строки замеров под мини-окном (?debug). */
function RenderStats() {
  useFrame((_, dt) => {
    if (dt > 0 && dt < 1) runtime.renderFps += (1 / dt - runtime.renderFps) * 0.05
  })
  return null
}

/**
 * 3D-сцена целиком: камера-«окно», свет, небо, физика, текущий уровень и постобработка.
 * Качество само снижается, если кадров в секунду мало (слабый ноутбук у жюри), и возвращается, когда их снова хватает.
 */
export function GameCanvas() {
  const phase = useGame((s) => s.phase)
  const runId = useGame((s) => s.runId)
  const sceneId = useGame((s) => s.sceneId)
  const Scene = SCENES[sceneId] ?? SCENES.lobby!
  // Сначала жертвуем сглаживанием и эффектами, чёткостью — в последнюю очередь и не ниже 80% (quality.ts).
  const deviceDpr = useDeviceDpr()
  const levels = useMemo(() => qualityLevels(deviceDpr), [deviceDpr])
  const [level, setLevel] = useState(0)
  const q = levels[Math.min(level, levels.length - 1)]
  useEffect(() => {
    runtime.lowQuality = q.low
    runtime.sharpness = q.dpr / levels[0].dpr
  }, [q, levels])

  return (
    <Canvas
      shadows
      dpr={q.dpr}
      frameloop={STEP_MODE ? 'never' : 'always'}
      // В режиме ?step картинку не стирать после кадра — иначе скриншот ловит пустой холст.
      gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: STEP_MODE }}
      className="game-canvas"
    >
      {STEP_MODE && <DebugStepper />}
      <RenderStats />
      <PerformanceMonitor
        bounds={qualityBounds}
        flipflops={QUALITY_FLIPFLOPS}
        onDecline={() => setLevel((l) => stepQuality(l, 'down', levels.length))}
        onIncline={() => setLevel((l) => stepQuality(l, 'up', levels.length))}
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
      <EffectComposer multisampling={q.msaa}>
        <Bloom mipmapBlur resolutionScale={0.5} luminanceThreshold={0.85} intensity={q.low ? 0.4 : 0.7} />
        <Vignette offset={0.25} darkness={0.45} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  )
}
