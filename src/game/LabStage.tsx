import { advance, Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { Physics } from '@react-three/rapier'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, type ReactNode } from 'react'
import { AtmosphereDriver } from './atmosphere/AtmosphereDriver'
import { Bursts, Lights, Sky } from './Environment'
import { Mist } from './world/Mist'
import { palette } from './palette'
import { Lobby } from './scenes/lobby/Lobby'
import { WindowCamera } from './WindowCamera'

/**
 * Сцена для стендов проверки (`?holo`, `?spirit`): настоящий мир лобби, тот же свет и постобработка, что в игре.
 * `&shot` в адресе — время стоит, кадры двигает скрипт: `labAdvance(секунды)` (повторяемые скриншоты,
 * работает и в фоновой вкладке).
 */

export const SHOT = new URLSearchParams(location.search).has('shot')
let shotTime = 0

/** Прокрутить сцену вперёд на seconds с шагом 1/60 с (только в режиме shot). */
export function labAdvance(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) advance((shotTime += 1 / 60))
}

/** В фоновой вкладке ResizeObserver молчит и холст не узнаёт свой размер — в режиме shot меряем сразу. */
class InstantResize {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    setTimeout(() => this.cb([{ target: el, contentRect: el.getBoundingClientRect() } as unknown as ResizeObserverEntry], this as never), 0)
  }
  unobserve() {}
  disconnect() {}
}

export function LabStage({ low, children }: { low: boolean; children: ReactNode }) {
  return (
    <Canvas
      frameloop={SHOT ? 'never' : 'always'}
      resize={SHOT ? { polyfill: InstantResize as never } : undefined}
      shadows
      dpr={low ? 1 : 1.25}
      gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT }}
      className="game-canvas"
    >
      <fog attach="fog" args={[palette.skyBottom, 60, 170]} />
      <AtmosphereDriver />
      <WindowCamera />
      <Sky />
      <Lights />
      <Mist />
      <Suspense fallback={null}>
        <Physics gravity={[0, -24, 0]} timeStep="vary">
          <Lobby />
        </Physics>
      </Suspense>
      <Bursts />
      {children}
      <EffectComposer multisampling={low ? 0 : 4}>
        <Bloom mipmapBlur luminanceThreshold={0.85} intensity={low ? 0.4 : 0.7} />
        <Vignette offset={0.25} darkness={0.45} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  )
}
