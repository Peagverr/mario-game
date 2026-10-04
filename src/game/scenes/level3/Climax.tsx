import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import { BoxGeometry, Vector3, type Group, type Mesh } from 'three'
import { useGame } from '../../../shared/gameStore'
import { palette } from '../../palette'
import { burst, runtime } from '../../runtime'
import { sfx } from '../../sfx'
import { spiritAlert, spiritCelebrate } from '../../spirit/spiritState'
import { PRIORITY, say } from '../../voice'
import { stoneKit } from '../../world/stoneKit'
import { IslandMesh, PlatformColliders } from '../level1/Platforms'
import type { Platform } from '../level1/levelData'
import { climaxProgress, climaxStart, climaxStep } from './climaxRules'

/**
 * Рушащийся остров (кульминация уровня «Поверни мир», правила — climaxRules.ts).
 * Коллайдер — тот же, что у обычного острова (PlatformColliders, те же данные); отдельно рисуем только вид,
 * чтобы его можно было трясти и уронить. Когда герой спасся и остров упал, тело острова выключается.
 */

/** Обломков одновременно в воздухе. */
const DEBRIS = 12
const GRAVITY = 18
/** «Успел»: сколько секунд остров ещё трясётся перед падением и сколько падает. */
const TREMBLE_S = 0.6
const FALL_S = 3

type Props = {
  /** Рушащийся остров. */
  p: Platform
  /** Последний остров — там безопасно. */
  safe: Platform
  /** Мост к последнему острову: начало и конец (x, z) и ширина. */
  bridge: { from: [number, number]; to: [number, number]; width: number }
}

const inside = (pos: Vector3, p: Platform, pad: number) =>
  Math.abs(pos.x - p.x) < p.w / 2 + pad && Math.abs(pos.z - p.z) < p.d / 2 + pad && pos.y > p.top - 1

/** Герой над мостом (отрезок from→to с запасом по ширине). */
function onBridgeLine(pos: Vector3, b: Props['bridge']) {
  const [ax, az] = b.from
  const [bx, bz] = b.to
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const k = Math.max(0, Math.min(1, ((pos.x - ax) * dx + (pos.z - az) * dz) / len2))
  return Math.hypot(pos.x - (ax + dx * k), pos.z - (az + dz * k)) < b.width / 2 + 0.6 && pos.y > -1
}

export function CrumblingIsland({ p, safe, bridge }: Props) {
  const body = useRef<RapierRigidBody>(null)
  const look = useRef<Group>(null)
  const sign = useRef<HTMLDivElement>(null)
  const rocks = useRef<(Mesh | null)[]>([])
  const st = useRef(climaxStart())
  const gone = useRef(false)

  const debris = useMemo(
    () => ({
      geo: new BoxGeometry(0.5, 0.4, 0.45),
      list: Array.from({ length: DEBRIS }, () => ({ alive: false, pos: new Vector3(), vel: new Vector3(), spin: new Vector3(), size: 1 })),
    }),
    [],
  )

  /** Выпустить обломок с края острова. */
  const spawn = (strength: number) => {
    const d = debris.list.find((x) => !x.alive)
    if (!d) return
    const side = Math.floor(Math.random() * 4)
    const along = (Math.random() - 0.5) * 0.9
    const ex = side < 2 ? (side === 0 ? -1 : 1) * (p.w / 2) : along * p.w
    const ez = side < 2 ? along * p.d : (side === 2 ? -1 : 1) * (p.d / 2)
    d.alive = true
    d.pos.set(p.x + ex, p.top - 0.3 - Math.random() * 1.5, p.z + ez)
    d.vel.set(Math.sign(ex) * Math.random() * 1.2, 0.5 + Math.random() * 2 * strength, Math.sign(ez) * Math.random() * 1.2)
    d.spin.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2)
    d.size = 0.6 + Math.random() * 1.1
  }

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const playing = useGame.getState().phase === 'playing'
    const pos = runtime.playerPos
    const s = st.current
    const ev = climaxStep(
      s,
      { playing, onIsland: inside(pos, p, 0.3), onBridge: onBridgeLine(pos, bridge), onSafe: inside(pos, safe, -0.4) },
      dt,
    )

    // «Остров разрушается», «беги к мосту» — только пока он рушится: успел раньше, чем голос дошёл до реплики, — не говорим.
    const stillRunning = () => st.current.phase === 'running'
    if (ev === 'start') {
      say('climax.shake', { priority: PRIORITY.story, waitMs: 4000, valid: stillRunning })
      say('climax.run', { priority: PRIORITY.story, waitMs: 6000, valid: stillRunning })
      spiritAlert()
      runtime.shake = Math.max(runtime.shake, 0.5)
      sfx.fall()
    } else if (ev === 'fail') {
      // Не успел: остров «сбросил» героя — возвращаем на середину острова, как после падения.
      const b = runtime.playerBody
      b?.setTranslation({ x: p.x, y: p.top + 1.2, z: p.z }, true)
      b?.setLinvel({ x: 0, y: 0, z: 0 }, true)
      runtime.shake = 0.9
      sfx.fall()
      burst(new Vector3(p.x, p.top + 0.5, p.z), palette.hero, 30, 6)
      useGame.getState().addFall()
      say('climax.run', { priority: PRIORITY.story, waitMs: 4000, valid: stillRunning })
    } else if (ev === 'escape') {
      say('climax.made', { priority: PRIORITY.story, waitMs: 4000 })
      spiritCelebrate()
      sfx.confirm()
      burst(new Vector3(safe.x, safe.top + 0.8, safe.z), palette.star, 26, 5)
    }

    // Тряска и обломки — сильнее к концу отсчёта.
    const k = climaxProgress(s)
    const g = look.current
    if (s.phase === 'running' && playing) {
      runtime.shake = Math.max(runtime.shake, 0.06 + 0.2 * k)
      if (Math.random() < dt * (2 + 9 * k)) spawn(0.5 + k)
      if (Math.random() < dt * (0.4 + 1.5 * k)) burst(new Vector3(p.x + (Math.random() - 0.5) * p.w, p.top, p.z + (Math.random() - 0.5) * p.d), palette.stone, 6, 2)
      const a = 0.015 + 0.05 * k
      g?.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.6, (Math.random() - 0.5) * a)
    } else if (s.phase === 'escaped' && g && !gone.current) {
      // Успел: остров ещё миг трясётся и падает в пропасть.
      const t = s.since
      if (t < TREMBLE_S) {
        const a = 0.12
        g.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a)
        if (Math.random() < dt * 20) spawn(1.5)
      } else {
        const f = t - TREMBLE_S
        g.position.set(0, -0.5 * GRAVITY * 0.4 * f * f, 0)
        g.rotation.set(f * 0.25, 0, f * -0.18)
        if (Math.random() < dt * 6) spawn(1)
      }
      if (t > TREMBLE_S + FALL_S) {
        gone.current = true
        g.visible = false
        // Герой уже на последнем острове; невидимый пол за спиной не нужен.
        body.current?.setEnabled(false)
      }
    }

    // Обломки летят вниз и пропадают в дымке.
    debris.list.forEach((d, i) => {
      const m = rocks.current[i]
      if (!m) return
      if (d.alive && playing) {
        d.vel.y -= GRAVITY * dt
        d.pos.addScaledVector(d.vel, dt)
        if (d.pos.y < p.top - 16) d.alive = false
      }
      m.visible = d.alive
      if (!d.alive) return
      m.position.copy(d.pos)
      m.rotation.x += d.spin.x * dt
      m.rotation.y += d.spin.y * dt
      m.rotation.z += d.spin.z * dt
      m.scale.setScalar(d.size)
    })

    // Отсчёт над островом.
    const el = sign.current
    if (el) {
      const show = s.phase === 'running'
      el.style.display = show ? '' : 'none'
      const text = `Остров рушится — ${Math.ceil(s.left)}`
      if (show && el.textContent !== text) el.textContent = text
    }
  })

  const kit = stoneKit()
  return (
    <>
      <RigidBody ref={body} type="fixed" colliders={false} position={[p.x, p.top, p.z]}>
        <PlatformColliders p={p} />
        <group ref={look}>
          <IslandMesh p={p} />
        </group>
      </RigidBody>
      {debris.list.map((_, i) => (
        <mesh key={i} ref={(m) => void (rocks.current[i] = m)} geometry={debris.geo} material={kit.rock} visible={false} castShadow />
      ))}
      <Html center position={[p.x, p.top + 3.2, p.z]} distanceFactor={26} zIndexRange={[10, 0]}>
        <div ref={sign} className="level-sign level-sign--small climax-sign" style={{ display: 'none' }} />
      </Html>
    </>
  )
}
