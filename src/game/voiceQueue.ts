/**
 * Кто и когда говорит — правила без звука, их проверяют тесты (voiceQueue.test.ts). Звук — в voice.ts.
 *
 * - Реплики не перебивают друг друга: новая ждёт, пока закончится текущая, плюс короткая пауза.
 * - Ждёт недолго: устаревшая реплика выбрасывается («подними руку», когда рука уже поднята, не нужна).
 * - Важнее — раньше: сюжет и подсказки идут вперёд реакций вроде «Чисто».
 * - once: реплика с таким ключом звучит один раз (подсказка-ошибка голосом — только первый раз, дальше текстом).
 */

export type VoiceItem = {
  id: string
  /** 3 — сюжет и обучение, 2 — подсказки, 1 — реакции. */
  priority: number
  /** Дольше этого (время по часам очереди) не ждём — выбрасываем. */
  expiresAt: number
  /** Ключ «один раз»: такой уже звучал — реплику не ставим. */
  once?: string
  /** Перед тем как сказать, проверить, что реплика ещё к месту. */
  valid?: () => boolean
}

/** Пауза между репликами (мс): голос не тараторит. */
export const GAP_MS = 350
/** Больше реплик не копим: лишние самые неважные выбрасываем. */
const MAX_QUEUE = 3

export class VoiceQueue {
  playing: VoiceItem | null = null
  private queue: VoiceItem[] = []
  private spoken = new Set<string>()
  private readyAt = 0

  /** Сколько реплик ждёт очереди. */
  get pending() {
    return this.queue.length
  }

  push(item: VoiceItem) {
    if (item.once && (this.spoken.has(item.once) || this.queue.some((q) => q.once === item.once))) return
    if (item.once && this.playing?.once === item.once) return
    this.queue.push(item)
    if (this.queue.length > MAX_QUEUE) {
      // Выбрасываем самую неважную, из равных — самую старую.
      let worst = 0
      this.queue.forEach((q, i) => {
        if (q.priority < this.queue[worst].priority) worst = i
      })
      this.queue.splice(worst, 1)
    }
  }

  /** Что сказать прямо сейчас (или null — говорить нечего или ещё рано). */
  take(now: number): VoiceItem | null {
    if (this.playing || now < this.readyAt) return null
    this.queue = this.queue.filter((q) => q.expiresAt >= now)
    while (this.queue.length) {
      let best = 0
      this.queue.forEach((q, i) => {
        if (q.priority > this.queue[best].priority) best = i
      })
      const [item] = this.queue.splice(best, 1)
      if (item.valid && !item.valid()) continue
      if (item.once) this.spoken.add(item.once)
      this.playing = item
      return item
    }
    return null
  }

  /** Реплика договорена. */
  done(now: number) {
    this.playing = null
    this.readyAt = now + GAP_MS
  }

  /** Сбросить очередь (новый забег): «один раз» помнится до перезагрузки страницы. */
  clear() {
    this.queue = []
  }
}
