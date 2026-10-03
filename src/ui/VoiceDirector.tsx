import { useEffect } from 'react'
import { clearVoice, hasLine, PRIORITY, say } from '../game/voice'
import { control, type HintCode } from '../shared/controlState'
import { useGame, type SceneId } from '../shared/gameStore'

/**
 * Режиссёр голоса: слушает игру и решает, какую реплику сказать. Ничего не рисует.
 * Реплики обучения — в Tutorial.tsx (у каждого шага своя), моста — в уровне «Поверни мир».
 */

/** Голосом говорим не чаще (мс): падения — бывают подряд, «я на связи» — когда игрок давно без рук. */
const FALL_COOLDOWN_MS = 12000
const IDLE_AFTER_MS = 25000
const IDLE_COOLDOWN_MS = 60000
const CAMERA_COOLDOWN_MS = 60000

/** Подсказка-ошибка → реплика. Нет в списке — подсказка только текстом. */
const HINT_LINE: Partial<Record<HintCode, string>> = {
  'no-hands': 'walk.raise',
}

/** Что сказать, когда уровень начался (после отсчёта). */
const LEVEL_INTRO: Partial<Record<SceneId, string[]>> = {
  level1: ['jump.cliff', 'jump.teach'],
  level2: ['window.intro', 'window.peek'],
  level3: ['rotate.intro'],
}

const story = (id: string, waitMs = 6000) => say(id, { priority: PRIORITY.story, waitMs })

export function VoiceDirector() {
  useEffect(() => {
    let lastFallAt = -Infinity
    let fallLine = 0

    const unsub = useGame.subscribe((s, p) => {
      if (s.runId !== p.runId) clearVoice()

      if (s.phase !== p.phase) {
        if (s.phase === 'tutorial' && (p.phase === 'start' || p.phase === 'loading')) story('awake.hello')
        // Обучение закончилось в лобби — к порталам.
        if (s.phase === 'playing' && p.phase === 'tutorial' && s.sceneId === 'lobby') story('short.lobby')
        if (s.phase === 'playing' && p.phase === 'countdown') LEVEL_INTRO[s.sceneId]?.forEach((id) => story(id, 8000))
        // Пауза из-за камеры — про неё скажет подсказка «камера», «пауза» тут лишняя.
        if (s.phase === 'paused' && p.phase === 'playing' && s.pauseReason === 'menu') say('short.pause', { waitMs: 1500 })
        if (s.phase === 'results') {
          clearVoice()
          story('finale.done')
          story('finale.results', 9000)
        }
      }
      if (s.phase !== 'playing' || s.runId !== p.runId) return

      // Тайная звезда («Загляни»): первая — с объяснением, дальше — коротко.
      if (s.secretsFound > p.secretsFound) {
        if (s.secretsFound === 1) story('window.found', 3000)
        else say(s.secretsFound % 2 ? 'short.exact' : 'short.clean', { waitMs: 1500 })
      } else if (s.starsCollected > p.starsCollected) {
        // Обычные звёзды: голосом только первую и последнюю — иначе голос надоест.
        if (s.starsCollected === 1) say('short.star', { waitMs: 1200 })
        else if (s.starsTotal > 0 && s.starsCollected === s.starsTotal) say('short.clean', { waitMs: 1500 })
      }

      if (s.falls > p.falls) {
        const now = performance.now()
        if (now - lastFallAt > FALL_COOLDOWN_MS) {
          lastFallAt = now
          say(fallLine++ % 2 ? 'fall.2' : 'fall.1', { waitMs: 1500 })
        }
      }
    })

    // Подсказки «режима ошибки» голосом — только первый раз за сессию (дальше — текстом на карточке).
    // И «я на связи», если в игре давно не видно рук.
    let raf = 0
    let seen = new Set<string>()
    let lastHandsAt = performance.now()
    let lastIdleAt = -Infinity
    let lastCameraAt = -Infinity
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const codes = new Set(control.hints.map((h) => h.code))
      for (const code of codes) {
        if (seen.has(code)) continue
        const id = HINT_LINE[code] ?? `hint.${code}`
        if (!hasLine(id)) continue
        const valid = () => control.hints.some((h) => h.code === code)
        // Про камеру — каждый раз, как она пропала, но не чаще раза в минуту: это не ошибка игрока, а поломка.
        if (code === 'camera-blocked') {
          if (now - lastCameraAt < CAMERA_COOLDOWN_MS) continue
          lastCameraAt = now
          say(id, { priority: PRIORITY.hint, waitMs: 2000, valid })
        } else say(id, { priority: PRIORITY.hint, once: `hint:${code}`, waitMs: 2000, valid })
      }
      seen = codes

      const g = useGame.getState()
      // Камеры нет — «подними ладонь» бессмысленно: про камеру уже сказано.
      if (control.hands.left || control.hands.right || g.phase !== 'playing' || control.tracking.camera !== 'ok') lastHandsAt = now
      else if (now - lastHandsAt > IDLE_AFTER_MS && now - lastIdleAt > IDLE_COOLDOWN_MS) {
        lastIdleAt = now
        say('short.idle', { waitMs: 2000 })
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      unsub()
      cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
