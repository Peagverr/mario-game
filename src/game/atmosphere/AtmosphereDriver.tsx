import { useFrame, useThree } from '@react-three/fiber'
import { Fog, Vector3 } from 'three'
import { runtime } from '../runtime'
import { useGame } from '../../shared/gameStore'
import { panoColorAt } from '../world/skyPano'
import { approachTime, createAtmo, RESULTS_TIME, SCENE_TIME, sampleAtmo } from './atmosphere'

/**
 * Текущая атмосфера — её читают небо, свет и облака каждый кадр.
 * `?t=0.6` в адресе — заморозить время суток (посмотреть любой момент без прохождения).
 */
export const atmo = createAtmo()

const forced = new URLSearchParams(location.search).get('t')
const FORCED_T = forced !== null && !Number.isNaN(Number(forced)) ? Math.min(1, Math.max(0, Number(forced))) : null

const camPos = new Vector3()
const camDir = new Vector3()
let current = FORCED_T ?? SCENE_TIME.lobby
sampleAtmo(current, atmo)

/** Время суток, к которому сейчас идём: по сцене, на итогах — рассвет. */
function targetTime() {
  if (FORCED_T !== null) return FORCED_T
  const g = useGame.getState()
  if (g.phase === 'results') return RESULTS_TIME
  return SCENE_TIME[g.sceneId as keyof typeof SCENE_TIME] ?? SCENE_TIME.lobby
}

/** Каждый кадр подводит время суток к цели и красит туман. Ставится в Canvas один раз. */
export function AtmosphereDriver() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useFrame((_, dt) => {
    current = approachTime(current, targetTime(), Math.min(dt, 0.1))
    sampleAtmo(current, atmo)
    if (!(scene.fog instanceof Fog)) scene.fog = new Fog(atmo.skyBottom, atmo.fogNear, atmo.fogFar)
    // Туман считаем от героя: камера в лобби стоит дальше (шире обзор), чем на уровнях.
    camera.getWorldPosition(camPos)
    const toHero = camPos.distanceTo(runtime.playerPos)
    // Цвет тумана — как фон-панорама там, куда смотрит камера: острова тают ровно в то, что за ними.
    camera.getWorldDirection(camDir)
    if (!panoColorAt(camDir.x, camDir.y, camDir.z, scene.fog.color)) scene.fog.color.copy(atmo.skyBottom)
    scene.fog.near = toHero + atmo.fogNear
    scene.fog.far = toHero + atmo.fogFar
  })
  return null
}
