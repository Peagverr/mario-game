import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  type Group,
  type Mesh,
} from 'three'
import { clamp01, easeInCubic, easeInOutCubic, easeOutBack, span } from '../holo/ease'
import { runtime } from '../runtime'
import { voiceLevel } from '../voice'
import { Blinker, followPoint, springStep, TrailBuffer } from './spiritMath'
import { makeBodyMaterial, makeSparkleMaterial, makeTrailMaterial } from './spiritMaterials'
import { spirit } from './spiritState'

/**
 * Дух Окна — маленький призрак из света рядом с героем (видимое тело голоса).
 *
 * Тело — поле расстояний (см. spiritMaterials.ts), здесь — жизнь: полёт на пружине к плечу героя или к цели,
 * покачивание, хвост волной и по ходу движения, крен и вытягивание на скорости, моргание, взгляд на героя,
 * цель или игрока (когда Окно говорит — смотрит на тебя и шевелит ротиком), светлый след на скорости,
 * искорки с хвоста. Чем управлять — объект spirit (spiritState.ts); компонент ставить в корень сцены.
 */

/** Единиц мира в единице духа: дух ~1.4 единицы ростом — с героя, голова крупная. */
const SCALE = 1.0
const APPEAR_S = 0.95
const VANISH_S = 0.7
const CELEBRATE_S = 1.15
const HAPPY_S = 1.6
const ALERT_S = 1.3
const MAX_SPARKS = 72
const SPARKS_LOW = 0.4
const TRAIL_N = 30
/** Пружины полёта: «рядом» — ленивее (парит), к цели — плавный долгий перелёт. */
const OMEGA_FOLLOW = 3.4
const OMEGA_GUIDE = 2.3

type Presence = 'hidden' | 'appearing' | 'present' | 'vanishing'

// Рабочие объекты — без выделения памяти в кадре.
const camQ = new Quaternion()
const rollQ = new Quaternion()
const camRight = new Vector3()
const camUp = new Vector3()
const camPos = new Vector3()
const inv = new Matrix4()
const tmp = new Vector3()
const tmp2 = new Vector3()
const headW = new Vector3()
const Z = new Vector3(0, 0, 1)

export function Spirit() {
  const camera = useThree((s) => s.camera)
  const group = useRef<Group>(null)
  const bodyMesh = useRef<Mesh>(null)
  const sparkMesh = useRef<Mesh>(null)
  const trailMesh = useRef<Mesh>(null)

  const mats = useMemo(() => ({ body: makeBodyMaterial(), trail: makeTrailMaterial(), spark: makeSparkleMaterial() }), [])
  const geos = useMemo(() => {
    const quad = new BufferGeometry()
    quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    quad.setIndex([0, 1, 2, 0, 2, 3])

    const spark = new InstancedBufferGeometry()
    spark.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    spark.setIndex([0, 1, 2, 0, 2, 3])
    const aPos = new InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3).setUsage(DynamicDrawUsage)
    const aData = new InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3).setUsage(DynamicDrawUsage)
    spark.setAttribute('aPos', aPos)
    spark.setAttribute('aData', aData)
    spark.instanceCount = 0

    // Лента следа: по две вершины на точку, треугольники между соседними точками.
    const trail = new BufferGeometry()
    const tPos = new BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3).setUsage(DynamicDrawUsage)
    const tUv = new BufferAttribute(new Float32Array(TRAIL_N * 2 * 2), 2).setUsage(DynamicDrawUsage)
    const tA = new BufferAttribute(new Float32Array(TRAIL_N * 2), 1).setUsage(DynamicDrawUsage)
    trail.setAttribute('position', tPos)
    trail.setAttribute('aUv', tUv)
    trail.setAttribute('aAlpha', tA)
    const idx: number[] = []
    for (let i = 0; i < TRAIL_N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    trail.setIndex(idx)
    trail.setDrawRange(0, 0)
    return { quad, spark, aPos, aData, trail, tPos, tUv, tA }
  }, [])

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose())
      geos.quad.dispose()
      geos.spark.dispose()
      geos.trail.dispose()
    },
    [mats, geos],
  )

  const st = useMemo(
    () => ({
      time: 0,
      presence: 'hidden' as Presence,
      pt: 0,
      pos: new Vector3(),
      vel: new Vector3(),
      target: new Vector3(),
      side: 1,
      guideSeen: spirit.guideSeq,
      guideLeft: 0,
      celebrateSeen: spirit.celebrateSeq,
      celebrateT: 99,
      alertSeen: spirit.alertSeq,
      alertT: 99,
      heroRising: false,
      voice: 0,
      mouth: 0,
      lookX: 0,
      lookY: 0,
      roll: 0,
      stretch: 0,
      trailVis: 0,
      pulseT: 0,
      blink: new Blinker(),
      trail: new TrailBuffer(TRAIL_N),
      sp: new Float32Array(MAX_SPARKS * 3),
      sv: new Float32Array(MAX_SPARKS * 3),
      life: new Float32Array(MAX_SPARKS),
      maxLife: new Float32Array(MAX_SPARKS),
      size: new Float32Array(MAX_SPARKS),
      spin: new Float32Array(MAX_SPARKS),
      next: 0,
      shedAcc: 0,
      // Хвост, ручки, глаза — в единицах духа; пишутся прямо в униформы.
      tail: mats.body.uniforms.uT.value as Vector3[],
      arms: mats.body.uniforms.uArm.value as Vector3[],
    }),
    [mats],
  )

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __spirit: st })
  }, [st])

  /** Искорка в мире: где, скорость, жизнь, размер. */
  const emit = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) => {
    const cap = runtime.lowQuality ? Math.floor(MAX_SPARKS * SPARKS_LOW) : MAX_SPARKS
    const i = st.next % cap
    st.next = (st.next + 1) % cap
    st.sp[i * 3] = x
    st.sp[i * 3 + 1] = y
    st.sp[i * 3 + 2] = z
    st.sv[i * 3] = vx
    st.sv[i * 3 + 1] = vy
    st.sv[i * 3 + 2] = vz
    st.life[i] = life
    st.maxLife[i] = life
    st.size[i] = size
    st.spin[i] = Math.random() * Math.PI
  }
  /** Вспышка искр во все стороны от точки (в плоскости экрана — их видно все). */
  const burstAt = (c: Vector3, n: number, speed: number, size: number) => {
    const k = runtime.lowQuality ? Math.ceil(n * SPARKS_LOW) : n
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + Math.random() * 0.4
      const sp = speed * (0.6 + Math.random() * 0.5)
      tmp2.copy(camRight).multiplyScalar(Math.cos(a) * sp).addScaledVector(camUp, Math.sin(a) * sp + 0.3)
      emit(c.x, c.y, c.z, tmp2.x, tmp2.y, tmp2.z, 0.6 + Math.random() * 0.4, size * (0.7 + Math.random() * 0.6))
    }
  }

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    st.time += dt
    const t = st.time
    const g = group.current
    if (!g) return
    camera.getWorldQuaternion(camQ)
    camera.getWorldPosition(camPos)
    camRight.set(1, 0, 0).applyQuaternion(camQ)
    camUp.set(0, 1, 0).applyQuaternion(camQ)
    const hero = runtime.playerPos

    // 1) Появиться / исчезнуть.
    if (spirit.present && (st.presence === 'hidden' || st.presence === 'vanishing')) {
      if (st.presence === 'hidden') {
        followPoint(hero, runtime.cameraYaw, st.side, st.pos)
        st.vel.set(0, 0, 0)
        st.trail.clear()
      }
      st.presence = 'appearing'
      st.pt = 0
    } else if (!spirit.present && (st.presence === 'present' || st.presence === 'appearing')) {
      st.presence = 'vanishing'
      st.pt = 0
    }
    st.pt += dt
    if (st.presence === 'appearing' && st.pt >= APPEAR_S) st.presence = 'present'
    if (st.presence === 'vanishing' && st.pt >= VANISH_S) st.presence = 'hidden'
    const visible = st.presence !== 'hidden'
    g.visible = visible
    updateSparks(dt)
    if (!visible) {
      updateTrail(0, dt)
      return
    }

    // 2) Куда лететь: к плечу героя или к цели; прыжок героя — взлетает с ним.
    if (spirit.guideSeq !== st.guideSeen) {
      st.guideSeen = spirit.guideSeq
      st.guideLeft = spirit.guideSeconds || Infinity
      st.pulseT = 0
    }
    if (spirit.mode === 'guide') {
      st.guideLeft -= dt
      if (st.guideLeft <= 0) spirit.mode = 'follow'
    }
    const guiding = spirit.mode === 'guide'
    if (guiding) st.target.set(spirit.guide.x, spirit.guide.y, spirit.guide.z)
    else followPoint(hero, runtime.cameraYaw, st.side, st.target)
    const rising = runtime.playerVel.y > 4
    if (rising && !st.heroRising && !guiding) st.vel.y += 3.2
    st.heroRising = rising
    // Покачивание и лёгкий дрейф — дух не висит неподвижно.
    st.target.y += 0.07 * Math.sin(t * 1.9) + 0.03 * Math.sin(t * 3.1 + 1)
    st.target.addScaledVector(camRight, 0.06 * Math.sin(t * 0.73))
    springStep(st.pos, st.vel, st.target, guiding ? OMEGA_GUIDE : OMEGA_FOLLOW, dt)

    // 3) Праздник: петля в плоскости экрана с оборотом. Тревога — тёплый оттенок.
    if (spirit.celebrateSeq !== st.celebrateSeen) {
      st.celebrateSeen = spirit.celebrateSeq
      st.celebrateT = 0
    }
    if (spirit.alertSeq !== st.alertSeen) {
      st.alertSeen = spirit.alertSeq
      st.alertT = 0
    }
    const ct = (st.celebrateT += dt)
    const loop = ct < CELEBRATE_S ? easeInOutCubic(ct / CELEBRATE_S) * Math.PI * 2 : 0
    tmp.copy(st.pos)
    if (loop > 0) {
      tmp.addScaledVector(camRight, Math.sin(loop) * 0.42 * st.side).addScaledVector(camUp, (1 - Math.cos(loop)) * 0.38)
      if (ct - dt < 0.04) burstAt(headW.copy(tmp).addScaledVector(camUp, 0.45), 16, 2.1, 0.12)
    }
    const at = (st.alertT += dt)
    const alert = at < ALERT_S ? Math.sin(Math.PI * clamp01(at / ALERT_S)) : 0

    // 4) Появление и исчезновение: масштаб с перелётом, искры слетаются / разлетаются.
    let grow = 1
    let eyesOpen = st.blink.open(t)
    if (st.presence === 'appearing') {
      if (st.pt - dt <= 0) {
        for (let i = 0; i < (runtime.lowQuality ? 8 : 18); i++) {
          // Искры на сфере вокруг — летят к центру и сходятся к ~0.45 с.
          const a = (i / 18) * Math.PI * 2
          const r = 1.1
          tmp2.copy(camRight).multiplyScalar(Math.cos(a) * r).addScaledVector(camUp, Math.sin(a) * r)
          emit(tmp.x + tmp2.x, tmp.y + 0.45 + tmp2.y, tmp.z + tmp2.z, -tmp2.x / 0.42, -tmp2.y / 0.42, -tmp2.z / 0.42, 0.42, 0.12)
        }
      }
      grow = span(st.pt, 0.32, 0.8, (x) => easeOutBack(x, 2.2))
      eyesOpen = Math.min(eyesOpen, span(st.pt, 0.65, 0.85))
    } else if (st.presence === 'vanishing') {
      grow = st.pt < 0.15 ? 1 + 0.12 * span(st.pt, 0, 0.15) : 1.12 * (1 - span(st.pt, 0.15, 0.55, easeInCubic))
      eyesOpen = 1 - span(st.pt, 0, 0.12)
      if (st.pt >= 0.4 && st.pt - dt < 0.4) burstAt(headW.copy(tmp).addScaledVector(camUp, 0.45), 20, 1.6, 0.1)
    }

    // 5) Поза: крен по ходу, вытягивание на скорости (сквош-стрейч), оборот в празднике.
    const vRight = st.vel.dot(camRight)
    const vUp = st.vel.dot(camUp)
    st.roll += (Math.max(-0.35, Math.min(0.35, -vRight * 0.09)) - st.roll) * (1 - Math.exp(-6 * dt))
    const speed = st.vel.length()
    st.stretch += (Math.max(-0.1, Math.min(0.16, Math.abs(vUp) * 0.035 - Math.abs(vRight) * 0.012)) - st.stretch) * (1 - Math.exp(-8 * dt))
    g.position.copy(tmp)
    rollQ.setFromAxisAngle(Z, st.roll + loop * st.side)
    g.quaternion.copy(camQ).multiply(rollQ)
    const sy = (1 + st.stretch) * grow * SCALE
    const sx = (grow * SCALE) / Math.sqrt(1 + st.stretch)
    g.scale.set(sx, sy, sx)
    g.updateMatrixWorld()

    // 6) Хвост: волна + струится против движения. Ручки покачиваются, в празднике — вверх.
    const lagX = Math.max(-0.4, Math.min(0.4, -vRight * 0.07))
    const lagY = Math.max(-0.25, Math.min(0.3, -vUp * 0.06))
    const happy = ct < HAPPY_S
    for (let i = 1; i < 4; i++) {
      const k = i / 3
      const w = t * 3.2 - i * 0.9
      st.tail[i].set(
        0.05 * i * k + Math.sin(w) * 0.045 * i + lagX * k ** 1.3,
        0.14 - 0.22 * i + lagY * k ** 1.3 + Math.abs(lagX) * 0.25 * k,
        Math.cos(w * 0.8) * 0.04 * i,
      )
    }
    st.tail[0].set(0, 0.14, 0)
    const armUp = happy ? Math.sin(Math.PI * clamp01(ct / HAPPY_S)) : 0
    const flap = Math.sin(t * 2.6) * 0.03
    st.arms[0].set(-0.17, 0.3, 0.03)
    st.arms[1].set(-0.31, 0.2 + flap + armUp * 0.24, 0.06)
    st.arms[2].set(0.17, 0.3, 0.03)
    st.arms[3].set(0.31, 0.2 - flap + armUp * 0.24, 0.06)

    // 7) Взгляд: когда Окно говорит — на игрока (в камеру), к цели — на цель, иначе на героя.
    const v = voiceLevel()
    st.voice += (v - st.voice) * (1 - Math.exp(-(v > st.voice ? 14 : 4) * dt))
    st.mouth += (Math.min(1, v * 1.6) - st.mouth) * (1 - Math.exp(-22 * dt))
    let lx = 0
    let ly = 0
    if (st.voice < 0.05) {
      if (guiding) tmp2.set(spirit.guide.x, spirit.guide.y, spirit.guide.z).sub(tmp)
      else tmp2.copy(hero).sub(tmp)
      if (guiding && tmp2.lengthSq() < 0.5) tmp2.copy(st.vel)
      lx = Math.max(-1, Math.min(1, tmp2.dot(camRight) / 1.5))
      ly = Math.max(-1, Math.min(1, tmp2.dot(camUp) / 1.5))
    }
    st.lookX += (lx - st.lookX) * (1 - Math.exp(-5 * dt))
    st.lookY += (ly - st.lookY) * (1 - Math.exp(-5 * dt))

    const u = mats.body.uniforms
    const head = u.uHead.value as Vector3
    const hr = u.uHeadR.value as Vector3
    head.set(st.lookX * 0.02, 0.6, 0)
    placeOnHead(u.uEyeL.value as Vector3, head, hr, -0.145 + st.lookX * 0.075, -0.03 + st.lookY * 0.05)
    placeOnHead(u.uEyeR.value as Vector3, head, hr, 0.145 + st.lookX * 0.075, -0.03 + st.lookY * 0.05)
    placeOnHead(u.uMouthPos.value as Vector3, head, hr, st.lookX * 0.06, -0.165 + st.lookY * 0.04)
    u.uOpen.value = eyesOpen
    u.uHappy.value = happy ? 1 : 0
    u.uMouth.value = st.mouth
    u.uVoice.value = st.voice
    u.uAlert.value = alert
    u.uTime.value = t
    u.uSteps.value = runtime.lowQuality ? 32 : 56
    // Свечение: дыхание с голосом, вспышка в празднике, мерцание у цели.
    if (guiding && st.pos.distanceTo(st.target) < 0.6) st.pulseT += dt
    const pulse = guiding ? 0.18 * Math.max(0, Math.sin(st.pulseT * 4.2)) : 0
    u.uGlow.value = 1 + 0.25 * st.voice + (ct < 0.4 ? 0.35 * (1 - ct / 0.4) : 0) + pulse
    // Камера — в координатах духа (луч считается там).
    inv.copy(g.matrixWorld).invert()
    ;(u.uCam.value as Vector3).copy(camPos).applyMatrix4(inv)

    // 8) Искорки с хвоста (на скорости — больше) и след-лента.
    const tipW = tmp2.copy(st.tail[3]).applyMatrix4(g.matrixWorld)
    const rate = (4 + speed * 5) * (runtime.lowQuality ? 0.5 : 1)
    st.shedAcc += rate * dt * grow
    while (st.shedAcc >= 1) {
      st.shedAcc -= 1
      emit(
        tipW.x + (Math.random() - 0.5) * 0.15,
        tipW.y + (Math.random() - 0.5) * 0.15,
        tipW.z,
        -st.vel.x * 0.15 + (Math.random() - 0.5) * 0.3,
        -st.vel.y * 0.15 - 0.15 - Math.random() * 0.2,
        -st.vel.z * 0.15,
        0.7 + Math.random() * 0.6,
        0.045 + Math.random() * 0.045,
      )
    }
    if (pulse > 0.17 && Math.random() < 0.3) burstAt(headW.copy(tmp).addScaledVector(camUp, 0.45), 1, 0.9, 0.09)
    updateTrail(speed, dt, tipW)
  })

  /** Лента следа за кончиком хвоста: видна только на скорости, на месте тает. */
  function updateTrail(speed: number, dt: number, tip?: Vector3) {
    const tr = st.trail
    if (tip) tr.update(tip, dt, 0.05, runtime.lowQuality ? 0.28 : 0.42)
    else tr.update(st.pos, dt, 1e9, 0)
    st.trailVis += ((speed > 2.2 ? 1 : 0) - st.trailVis) * (1 - Math.exp(-(speed > 2.2 ? 8 : 3) * dt))
    mats.trail.uniforms.uOpacity.value = st.trailVis
    const n = tr.count
    const m = trailMesh.current
    if (m) m.visible = n > 1 && st.trailVis > 0.02
    if (n < 2) return
    const P = geos.tPos.array as Float32Array
    const UV = geos.tUv.array as Float32Array
    const A = geos.tA.array as Float32Array
    for (let i = 0; i < n; i++) {
      const j = tr.index(i)
      const jn = tr.index(Math.min(i + 1, n - 1))
      const jp = tr.index(Math.max(i - 1, 0))
      // Ширина поперёк пути, лицом к камере.
      tmp.set(tr.x[jp] - tr.x[jn], tr.y[jp] - tr.y[jn], tr.z[jp] - tr.z[jn])
      tmp2.set(camPos.x - tr.x[j], camPos.y - tr.y[j], camPos.z - tr.z[j])
      tmp.cross(tmp2).normalize()
      const u = i / (n - 1)
      const w = 0.13 * (1 - u * 0.8)
      // Лента струится: поперёк пути бежит лёгкая волна, к хвосту сильнее.
      const wave = Math.sin(u * 7 - st.time * 9) * 0.07 * u
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? 1 : -1
        const o = (i * 2 + s) * 3
        P[o] = tr.x[j] + tmp.x * (w * sign + wave)
        P[o + 1] = tr.y[j] + tmp.y * (w * sign + wave)
        P[o + 2] = tr.z[j] + tmp.z * (w * sign + wave)
        UV[(i * 2 + s) * 2] = u
        UV[(i * 2 + s) * 2 + 1] = sign
        A[i * 2 + s] = 1
      }
    }
    geos.trail.setDrawRange(0, (n - 1) * 6)
    geos.tPos.needsUpdate = true
    geos.tUv.needsUpdate = true
    geos.tA.needsUpdate = true
  }

  function updateSparks(dt: number) {
    let alive = 0
    const P = geos.aPos.array as Float32Array
    const D = geos.aData.array as Float32Array
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (st.life[i] <= 0) continue
      st.life[i] -= dt
      if (st.life[i] <= 0) continue
      const drag = Math.exp(-2.4 * dt)
      for (let c = 0; c < 3; c++) {
        st.sv[i * 3 + c] *= drag
        st.sp[i * 3 + c] += st.sv[i * 3 + c] * dt
      }
      const k = st.life[i] / st.maxLife[i]
      P[alive * 3] = st.sp[i * 3]
      P[alive * 3 + 1] = st.sp[i * 3 + 1]
      P[alive * 3 + 2] = st.sp[i * 3 + 2]
      // Звёздочка: в начале вспыхивает, к концу гаснет и уменьшается; медленно вращается.
      D[alive * 3] = st.size[i] * (0.4 + 0.6 * Math.sqrt(k)) * (k > 0.85 ? (1 - k) / 0.15 + 0.3 : 1)
      D[alive * 3 + 1] = Math.min(1, k * 1.8)
      D[alive * 3 + 2] = st.spin[i] + (1 - k) * 1.5
      alive++
    }
    geos.spark.instanceCount = alive
    geos.aPos.needsUpdate = true
    geos.aData.needsUpdate = true
    if (sparkMesh.current) sparkMesh.current.visible = alive > 0
  }

  return (
    <>
      <mesh ref={trailMesh} geometry={geos.trail} material={mats.trail} frustumCulled={false} renderOrder={30} visible={false} />
      <group ref={group} visible={false}>
        <mesh ref={bodyMesh} geometry={geos.quad} material={mats.body} frustumCulled={false} renderOrder={31} />
      </group>
      <mesh ref={sparkMesh} geometry={geos.spark} material={mats.spark} frustumCulled={false} renderOrder={32} visible={false} />
    </>
  )
}

/** Точка на передней поверхности головы-эллипсоида по смещению (x, y) от центра — для глаз и ротика. */
function placeOnHead(out: Vector3, head: Vector3, r: Vector3, x: number, y: number) {
  const q = 1 - (x / r.x) ** 2 - (y / r.y) ** 2
  out.set(head.x + x, head.y + y, head.z + r.z * Math.sqrt(Math.max(0.05, q)))
}
