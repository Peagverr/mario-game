import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Quaternion,
  Vector3,
  type Group,
  type Mesh,
} from 'three'
import { runtime } from '../runtime'
import { sfx } from '../sfx'
import { voiceLevel } from '../voice'
import { FRAME_LEN, sampleClip, type HandClip } from './clip'
import { getClip } from './clips'
import { clamp01, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, span } from './ease'
import type { HoloCue } from './holoCue'
import { makeBaseMaterial, makeBeamMaterial, makeGuideRingMaterial, makeInkMaterial, makeLightMaterial, makePalmMaterial } from './holoMaterials'
import { CHAIN_S, JOINTS, PALM_OUTLINE, STROKES } from './holoRig'

/**
 * Голограмма руки — показывает игроку жест. «Скелет из света»: штрихи-кости, узлы-суставы, стеклянная ладонь,
 * под ней — проектор с лучом. Рука всегда параллельна экрану (видно ладонь и жест) и зеркальна, как своя рука.
 *
 * Жизнь: появляется (кости вырастают от запястья волной по пальцам, вспышка), играет клип по кругу,
 * по костям бежит импульс света, свечение «дышит» с голосом Окна. Повторил жест — рассыпается искрами вверх со звоном.
 *
 * Чем управлять — объект cue (holoCue.ts) и точка target: их читаем каждый кадр, без перерисовки React.
 * Компонент ставить в корень сцены (частицы — в мировых координатах).
 */

type Props = {
  cue: HoloCue
  /** Куда лететь: центр ладони в мире. Можно менять на месте каждый кадр. */
  target: Vector3
  /** Высота земли под рукой — там стоит проектор. */
  groundY: number
  /** Единиц мира в метре руки (рука 18 см × 9 ≈ 1.7 единицы — чуть выше героя). */
  scale?: number
  /** Позвать, когда голограмма исчезла совсем. */
  onHidden?: () => void
}

const MATERIALIZE_S = 1.2
/** К этому моменту появления все кости уже выросли — можно рассыпаться. */
const BUILT_S = 0.92
const DISSOLVE_S = 1.1
/** Пружина полёта к цели (критическое затухание): больше — быстрее догоняет. */
const SPRING = 4.5
const N_STROKES = STROKES.length
const N_INST = N_STROKES + JOINTS.length
const MAX_SPARKS = 90
const SPARKS_LOW = 0.4

type Phase = 'hidden' | 'materializing' | 'shown' | 'dissolving'

// Рабочие векторы — без выделения памяти в кадре.
const camQ = new Quaternion()
const rollQ = new Quaternion()
const camRight = new Vector3()
const Z = new Vector3(0, 0, 1)
const tmp = new Vector3()

/** Когда элемент появляется и исчезает: волна от запястья по пальцам (большой — первым), и обратно с кончиков. */
const growStart = (depth: number, finger: number) => 0.34 + depth * 0.085 + finger * 0.03
const GROW_S = 0.2
const shrinkStart = (depth: number, finger: number) => 0.08 + (3 - depth) * 0.07 + (4 - finger) * 0.022
const SHRINK_S = 0.15

export function HoloHand({ cue, target, groundY, scale = 9, onHidden }: Props) {
  const camera = useThree((s) => s.camera)
  const outer = useRef<Group>(null)
  const inner = useRef<Group>(null)
  const base = useRef<Group>(null)
  const beam = useRef<Mesh>(null)
  const ring = useRef<Mesh>(null)
  const sparksLight = useRef<Mesh>(null)
  const hiddenCb = useRef(onHidden)
  hiddenCb.current = onHidden

  const mats = useMemo(() => {
    const ink = makeInkMaterial()
    const light = makeLightMaterial()
    const sparkLight = makeLightMaterial()
    for (const m of [ink, light]) m.uniforms.uScale.value = scale
    // Искры — в мировых координатах (радиусы сразу в единицах мира) и без тёмного контура:
    // с ним они похожи на пузыри. Тело темнее неба, ядро — белое.
    sparkLight.uniforms.uScale.value = 1
    sparkLight.uniforms.uPad.value = 0.01
    sparkLight.uniforms.uPulse.value = 0
    sparkLight.uniforms.uBody.value.set('#1fb3aa')
    sparkLight.uniforms.uEdge.value.set('#0e7f86')
    return { ink, light, sparkLight, palm: makePalmMaterial(), base: makeBaseMaterial(), beam: makeBeamMaterial(), guide: makeGuideRingMaterial() }
  }, [scale])

  // Штрихи и узлы: один квадрат, размноженный на экземпляры; два прохода (подложка и свет) делят геометрию.
  const strokes = useMemo(() => makeStrokeGeometry(N_INST), [])
  const sparks = useMemo(() => makeStrokeGeometry(MAX_SPARKS), [])
  const palmGeo = useMemo(() => {
    const g = new BufferGeometry()
    const n = PALM_OUTLINE.length
    g.setAttribute('position', new BufferAttribute(new Float32Array((n + 1) * 3), 3).setUsage(DynamicDrawUsage))
    g.setAttribute('aEdge', new Float32BufferAttribute([0, ...PALM_OUTLINE.map(() => 1)], 1))
    const idx: number[] = []
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n))
    g.setIndex(idx)
    return g
  }, [])
  const beamGeo = useMemo(() => new CylinderGeometry(1, 0.32, 1, 40, 1, true).translate(0, 0.5, 0), [])

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose())
      ;[strokes.geo, sparks.geo, palmGeo, beamGeo].forEach((g) => g.dispose())
    },
    [mats, strokes, sparks, palmGeo, beamGeo],
  )

  const st = useMemo(
    () => ({
      phase: 'hidden' as Phase,
      phaseT: 0,
      success: false,
      cueSeen: -1,
      clip: null as HandClip | null,
      playT: 0,
      pos: new Vector3(),
      vel: new Vector3(),
      roll: 0,
      voice: 0,
      time: 0,
      pts: new Float32Array(FRAME_LEN),
      move: new Float32Array(3),
      grow: new Float32Array(N_STROKES),
      emitAcc: new Float32Array(N_INST),
      jointGone: new Uint8Array(JOINTS.length),
      // Искры: позиция, скорость, жизнь, размер.
      sp: new Float32Array(MAX_SPARKS * 3),
      sv: new Float32Array(MAX_SPARKS * 3),
      life: new Float32Array(MAX_SPARKS),
      maxLife: new Float32Array(MAX_SPARKS),
      size: new Float32Array(MAX_SPARKS),
      nextSpark: 0,
    }),
    [],
  )

  // Только в разработке: состояние видно снаружи — для автоматических скриншотов и проверок (`?holo&shot`).
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __holoHand: st })
  }, [st])

  /** Искра в точке руки (метры руки → мир через матрицу внутренней группы). */
  const emit = (lx: number, ly: number, lz: number, big: boolean) => {
    const g = inner.current
    if (!g) return
    const cap = runtime.lowQuality ? Math.floor(MAX_SPARKS * SPARKS_LOW) : MAX_SPARKS
    const i = st.nextSpark % cap
    st.nextSpark = (st.nextSpark + 1) % cap
    tmp.set(lx, ly, lz).applyMatrix4(g.matrixWorld)
    st.sp[i * 3] = tmp.x
    st.sp[i * 3 + 1] = tmp.y
    st.sp[i * 3 + 2] = tmp.z
    // Вверх и чуть в стороны; дальше — сопротивление воздуха и плавное покачивание.
    const a = Math.random() * Math.PI * 2
    const out = 0.25 + Math.random() * 0.35
    st.sv[i * 3] = Math.cos(a) * out
    st.sv[i * 3 + 1] = 0.55 + Math.random() * 0.7
    st.sv[i * 3 + 2] = Math.sin(a) * out
    const life = 0.75 + Math.random() * 0.6
    st.life[i] = life
    st.maxLife[i] = life
    st.size[i] = (big ? 0.0056 : 0.003 + Math.random() * 0.0018) * scale
  }

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    st.time += dt
    const t = st.time

    // 1) Состояния: появиться по новому показу, рассыпаться, когда жест повторён или показ сменился.
    if (st.phase === 'hidden') {
      if (cue.clip && cue.cue !== st.cueSeen && !cue.matched) {
        st.clip = getClip(cue.clip)
        st.cueSeen = cue.cue
        st.phase = 'materializing'
        st.phaseT = 0
        st.playT = 0
        st.pos.copy(target)
        st.vel.set(0, 0, 0)
        st.jointGone.fill(0)
        st.emitAcc.fill(0)
      }
    } else if (st.phase !== 'dissolving') {
      const stale = !cue.clip || cue.cue !== st.cueSeen
      // Недостроенная рука не рассыпается: сначала кости дорастают (иначе выглядит как сбой).
      const built = st.phase === 'shown' || st.phaseT >= BUILT_S
      if ((cue.matched || stale) && built) {
        st.phase = 'dissolving'
        st.success = cue.matched && !stale
        st.phaseT = 0
        if (st.success) sfx.holo()
      }
    }
    st.phaseT += dt
    if (st.phase === 'materializing' && st.phaseT >= MATERIALIZE_S) st.phase = 'shown'
    if (st.phase === 'dissolving' && st.phaseT >= DISSOLVE_S) {
      st.phase = 'hidden'
      hiddenCb.current?.()
    }

    const visible = st.phase !== 'hidden'
    if (outer.current) outer.current.visible = visible
    if (base.current) base.current.visible = visible
    updateSparks(dt)
    if (!visible || !st.clip || !outer.current || !inner.current) return

    // 2) Полёт к цели: пружина с критическим затуханием + лёгкое покачивание в воздухе.
    tmp.copy(target).sub(st.pos).multiplyScalar(SPRING * SPRING * dt)
    st.vel.add(tmp).multiplyScalar(Math.max(0, 1 - 2 * SPRING * dt))
    st.pos.addScaledVector(st.vel, dt)
    camera.getWorldQuaternion(camQ)
    camRight.set(1, 0, 0).applyQuaternion(camQ)
    // На лету рука слегка кренится по ходу движения — как настоящая.
    const lean = Math.max(-0.18, Math.min(0.18, -st.vel.dot(camRight) * 0.07))
    st.roll += (lean - st.roll) * (1 - Math.exp(-6 * dt))
    const bob = 0.045 * Math.sin(t * 1.55) + 0.018 * Math.sin(t * 2.7 + 1.3)
    outer.current.position.set(st.pos.x, st.pos.y + bob, st.pos.z)
    rollQ.setFromAxisAngle(Z, st.roll)
    outer.current.quaternion.copy(camQ).multiply(rollQ)

    // 3) Яркость: вспышки появления и успеха, дыхание с голосом, едва заметное мерцание.
    const v = voiceLevel()
    st.voice += (v - st.voice) * (1 - Math.exp(-(v > st.voice ? 14 : 4) * dt))
    const m = st.phase === 'materializing' ? st.phaseT : MATERIALIZE_S + 1
    const d = st.phase === 'dissolving' ? st.phaseT : -1
    let flash = m > 0.92 ? 0.6 * Math.exp(-(m - 0.92) / 0.2) * clamp01((m - 0.92) / 0.04) : 0
    if (d >= 0 && st.success) flash += 0.75 * Math.exp(-d / 0.16)
    const flicker = 1 + 0.018 * Math.sin(t * 31) * Math.sin(t * 7.3) - (((t * 0.23) % 1) < 0.01 ? 0.1 : 0)
    const intensity = (1 + flash) * (1 + 0.4 * st.voice) * flicker
    mats.light.uniforms.uIntensity.value = intensity
    mats.light.uniforms.uTime.value = t
    mats.base.uniforms.uIntensity.value = 1 + 0.5 * st.voice + flash * 0.5
    mats.base.uniforms.uTime.value = t
    mats.beam.uniforms.uTime.value = t

    // 4) Кадр клипа (метры руки) + сдвиг ладони.
    st.playT += dt
    sampleClip(st.clip, st.playT, st.pts, st.move)
    const P = st.pts
    for (let i = 0; i < 21; i++) {
      P[i * 3] += st.move[0]
      P[i * 3 + 1] += st.move[1]
      P[i * 3 + 2] += st.move[2]
    }

    // 5) Кости: вырастают при появлении, втягиваются к запястью при исчезновении (и сыплют искры).
    const lowQ = runtime.lowQuality
    const geo = strokes
    for (let k = 0; k < N_STROKES; k++) {
      const s = STROKES[k]
      let g = 1
      if (m <= MATERIALIZE_S) g = span(m, growStart(s.depth, s.finger), growStart(s.depth, s.finger) + GROW_S, easeOutCubic)
      if (d >= 0) {
        const t0 = shrinkStart(s.depth, s.finger)
        const ng = 1 - span(d, t0, t0 + SHRINK_S, easeInCubic)
        // Искры там, где сейчас конец втягивающейся кости.
        const budget = (s.alpha < 1 ? 0.6 : 2.4) * (lowQ ? SPARKS_LOW : 1) * (st.success ? 1 : 0.6)
        st.emitAcc[k] += Math.max(0, st.grow[k] - ng) * budget
        while (st.emitAcc[k] >= 1) {
          st.emitAcc[k] -= 1
          const f = ng + Math.random() * (st.grow[k] - ng)
          emit(lerpP(P, s.a, s.b, f, 0), lerpP(P, s.a, s.b, f, 1), lerpP(P, s.a, s.b, f, 2), false)
        }
        g = ng
      }
      st.grow[k] = g
      const o = k * 3
      geo.a.array[o] = P[s.a * 3]
      geo.a.array[o + 1] = P[s.a * 3 + 1]
      geo.a.array[o + 2] = P[s.a * 3 + 2]
      geo.b.array[o] = lerpP(P, s.a, s.b, g, 0)
      geo.b.array[o + 1] = lerpP(P, s.a, s.b, g, 1)
      geo.b.array[o + 2] = lerpP(P, s.a, s.b, g, 2)
      geo.r.array[k * 2] = g > 0.001 ? s.ra : 0
      geo.r.array[k * 2 + 1] = g > 0.001 ? s.ra + (s.rb - s.ra) * g : 0
      geo.s.array[k * 2] = CHAIN_S[s.a]
      geo.s.array[k * 2 + 1] = CHAIN_S[s.a] + (CHAIN_S[s.b] - CHAIN_S[s.a]) * g
      geo.k.array[o] = s.core
      // Невидимая кость — прозрачна целиком, иначе подложка оставит точку-контур.
      geo.k.array[o + 1] = g > 0.001 ? s.alpha : 0
      geo.k.array[o + 2] = s.gain
    }

    // 6) Суставы: «щелчок» с перелётом, когда до них дорастает кость; гаснут, когда их кость начинает втягиваться.
    for (let j = 0; j < JOINTS.length; j++) {
      const J = JOINTS[j]
      let pop = 1
      if (m <= MATERIALIZE_S) {
        if (J.i === 0) {
          // Запястье — «зерно»: вспыхивает первым, сжимается (замах) и отпускает кости.
          const grow = span(m, 0.06, 0.26, (x) => easeOutBack(x, 3))
          pop = grow * (1 - 0.35 * Math.sin(Math.PI * span(m, 0.26, 0.42, (x) => x)))
        } else {
          const at = growStart(J.depth - 1, J.finger) + GROW_S * 0.8
          pop = span(m, at, at + 0.22, (x) => easeOutBack(x, 2.4))
        }
      }
      if (d >= 0) {
        const at = J.i === 0 ? shrinkStart(-1, 0) : shrinkStart(J.depth - 1, J.finger)
        const out = J.i === 0 ? span(d, at, at + 0.18, easeInCubic) : span(d, at - 0.02, at + 0.08, easeInCubic)
        if (out > 0 && !st.jointGone[j]) {
          st.jointGone[j] = 1
          const n = J.depth === 4 || J.i === 0 ? 3 : 1
          for (let e = 0; e < (lowQ ? 1 : n); e++) emit(P[J.i * 3], P[J.i * 3 + 1], P[J.i * 3 + 2], e === 0)
        }
        // Перед тем как погаснуть, узел на миг набухает — последняя вспышка.
        pop = (1 - out) * (1 + 0.5 * Math.sin(Math.PI * clamp01(out * 1.4)))
      }
      const k = N_STROKES + j
      const o = k * 3
      for (let c = 0; c < 3; c++) {
        geo.a.array[o + c] = P[J.i * 3 + c]
        geo.b.array[o + c] = P[J.i * 3 + c]
      }
      geo.r.array[k * 2] = J.r * pop
      geo.r.array[k * 2 + 1] = J.r * pop
      geo.s.array[k * 2] = CHAIN_S[J.i]
      geo.s.array[k * 2 + 1] = CHAIN_S[J.i]
      geo.k.array[o] = J.core
      geo.k.array[o + 1] = pop > 0.001 ? 1 : 0
      geo.k.array[o + 2] = J.gain
    }
    geo.markDirty(N_INST)

    // 7) Ладонь-стекло и круг-подсказка.
    const palmA = m <= MATERIALIZE_S ? span(m, 0.5, 0.95) : d >= 0 ? 1 - span(d, 0.18, 0.45) : 1
    mats.palm.uniforms.uOpacity.value = palmA
    const pos = palmGeo.attributes.position as BufferAttribute
    let cx = 0
    let cy = 0
    let cz = 0
    for (let n = 0; n < PALM_OUTLINE.length; n++) {
      const pi = PALM_OUTLINE[n] * 3
      pos.setXYZ(n + 1, P[pi], P[pi + 1], P[pi + 2])
      cx += P[pi]
      cy += P[pi + 1]
      cz += P[pi + 2]
    }
    pos.setXYZ(0, cx / PALM_OUTLINE.length, cy / PALM_OUTLINE.length, cz / PALM_OUTLINE.length)
    pos.needsUpdate = true

    if (ring.current) {
      const r = st.clip.ring
      ring.current.visible = r > 0
      if (r > 0) {
        ring.current.scale.setScalar(r / 0.86)
        const out = Math.hypot(st.move[0], st.move[1]) > r * 0.9 ? 1 : 0
        mats.guide.uniforms.uHot.value += (out - mats.guide.uniforms.uHot.value) * (1 - Math.exp(-10 * dt))
        mats.guide.uniforms.uOpacity.value = palmA
        mats.guide.uniforms.uWidth.value = 0.0011 / r
      }
    }

    // 8) Проектор под рукой: раскрывается первым, гаснет последним; луч — от линзы до запястья.
    if (base.current && beam.current) {
      base.current.position.set(st.pos.x, groundY + 0.03, st.pos.z)
      const open = m <= MATERIALIZE_S ? span(m, 0, 0.42, (x) => easeOutBack(x, 1.3)) : d >= 0 ? 1 - span(d, 0.55, 0.95, easeInCubic) : 1
      mats.base.uniforms.uOpen.value = open
      const beamA = m <= MATERIALIZE_S ? span(m, 0.12, 0.6) : d >= 0 ? 1 - span(d, 0.35, 0.8, easeInOutCubic) : 1
      mats.beam.uniforms.uOpacity.value = beamA * (0.22 + 0.1 * st.voice)
      const top = st.pos.y + bob - 0.075 * scale - groundY
      beam.current.visible = top > 0.3
      beam.current.scale.set(0.06 * scale, Math.max(0.01, top), 0.06 * scale)
    }
  })

  /** Искры живут в мире: всплывают, замедляются, покачиваются, гаснут и тают. */
  function updateSparks(dt: number) {
    const g = sparks
    let alive = 0
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (st.life[i] <= 0) continue
      st.life[i] -= dt
      const k = Math.max(0, st.life[i] / st.maxLife[i])
      const drag = Math.exp(-2.2 * dt)
      st.sv[i * 3] *= drag
      st.sv[i * 3 + 2] *= drag
      st.sv[i * 3 + 1] = st.sv[i * 3 + 1] * Math.exp(-0.9 * dt) + 0.25 * dt
      st.sp[i * 3] += (st.sv[i * 3] + Math.sin(st.time * 3 + i) * 0.08) * dt
      st.sp[i * 3 + 1] += st.sv[i * 3 + 1] * dt
      st.sp[i * 3 + 2] += st.sv[i * 3 + 2] * dt
      if (st.life[i] <= 0) continue
      const o = alive * 3
      const r = st.size[i] * Math.pow(k, 0.6)
      // Искра — короткий штрих по скорости: голова круглая, хвост тоньше.
      for (let c = 0; c < 3; c++) {
        g.a.array[o + c] = st.sp[i * 3 + c]
        g.b.array[o + c] = st.sp[i * 3 + c] - st.sv[i * 3 + c] * 0.07
      }
      g.r.array[alive * 2] = r
      g.r.array[alive * 2 + 1] = r * 0.35
      g.s.array[alive * 2] = 1
      g.s.array[alive * 2 + 1] = 1
      g.k.array[o] = 1
      g.k.array[o + 1] = easeOutCubic(clamp01(k * 2.5))
      g.k.array[o + 2] = 1.1
      alive++
    }
    g.markDirty(alive)
    if (sparksLight.current) sparksLight.current.visible = alive > 0
  }

  return (
    <>
      <group ref={outer} visible={false}>
        <group ref={inner} scale={scale}>
          <mesh geometry={strokes.geo} material={mats.ink} frustumCulled={false} renderOrder={20} />
          <mesh ref={ring} geometry={PLANE} material={mats.guide} position={[0, 0, -0.012]} renderOrder={19} visible={false} />
          <mesh geometry={palmGeo} material={mats.palm} frustumCulled={false} renderOrder={21} />
          <mesh geometry={strokes.geo} material={mats.light} frustumCulled={false} renderOrder={22} />
        </group>
      </group>
      <group ref={base} visible={false}>
        <mesh rotation-x={-Math.PI / 2} scale={0.085 * scale} material={mats.base} renderOrder={16}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        <mesh ref={beam} geometry={beamGeo} material={mats.beam} renderOrder={17} frustumCulled={false} />
      </group>
      <mesh ref={sparksLight} geometry={sparks.geo} material={mats.sparkLight} frustumCulled={false} renderOrder={24} visible={false} />
    </>
  )
}

const PLANE = new BufferGeometry()
{
  // Квадрат 2×2 с uv — подложка круга-подсказки.
  PLANE.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  PLANE.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  PLANE.setIndex([0, 1, 2, 0, 2, 3])
}

const lerpP = (P: Float32Array, a: number, b: number, f: number, c: number) => P[a * 3 + c] + (P[b * 3 + c] - P[a * 3 + c]) * f

/** Квадрат-штрих на N экземпляров: концы, радиусы, доля пути от запястья, (ядро, прозрачность, яркость). */
function makeStrokeGeometry(n: number) {
  const geo = new InstancedBufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage)
  const a = attr(3)
  const b = attr(3)
  const r = attr(2)
  const s = attr(2)
  const k = attr(3)
  geo.setAttribute('aA', a)
  geo.setAttribute('aB', b)
  geo.setAttribute('aR', r)
  geo.setAttribute('aS', s)
  geo.setAttribute('aK', k)
  geo.instanceCount = 0
  return {
    geo,
    a,
    b,
    r,
    s,
    k,
    markDirty(count: number) {
      geo.instanceCount = count
      for (const x of [a, b, r, s, k]) x.needsUpdate = true
    },
  }
}
