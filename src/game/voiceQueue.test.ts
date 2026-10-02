import { describe, expect, it } from 'vitest'
import { GAP_MS, VoiceQueue, type VoiceItem } from './voiceQueue'

const item = (id: string, priority = 1, extra: Partial<VoiceItem> = {}): VoiceItem => ({ id, priority, expiresAt: 10_000, ...extra })

describe('VoiceQueue', () => {
  it('говорит сразу, если тихо', () => {
    const q = new VoiceQueue()
    q.push(item('a'))
    expect(q.take(0)?.id).toBe('a')
  })

  it('не перебивает: следующая ждёт конца и паузы', () => {
    const q = new VoiceQueue()
    q.push(item('a'))
    q.take(0)
    q.push(item('b', 3))
    expect(q.take(100)).toBeNull()
    q.done(1000)
    expect(q.take(1000 + GAP_MS - 1)).toBeNull()
    expect(q.take(1000 + GAP_MS)?.id).toBe('b')
  })

  it('важное раньше, из равных — по порядку', () => {
    const q = new VoiceQueue()
    q.push(item('reaction', 1))
    q.push(item('story1', 3))
    q.push(item('story2', 3))
    expect(q.take(0)?.id).toBe('story1')
    q.done(0)
    expect(q.take(GAP_MS)?.id).toBe('story2')
    q.done(GAP_MS)
    expect(q.take(GAP_MS * 2)?.id).toBe('reaction')
  })

  it('устаревшую выбрасывает', () => {
    const q = new VoiceQueue()
    q.push(item('a'))
    q.take(0)
    q.push(item('late', 2, { expiresAt: 500 }))
    q.done(2000)
    expect(q.take(3000)).toBeNull()
  })

  it('не к месту — не говорит', () => {
    const q = new VoiceQueue()
    q.push(item('stale', 2, { valid: () => false }))
    q.push(item('ok', 1))
    expect(q.take(0)?.id).toBe('ok')
  })

  it('once: второй раз не звучит, даже если поставили дважды', () => {
    const q = new VoiceQueue()
    q.push(item('hint', 2, { once: 'fist' }))
    q.push(item('hint', 2, { once: 'fist' }))
    expect(q.take(0)?.id).toBe('hint')
    q.done(0)
    q.push(item('hint', 2, { once: 'fist' }))
    expect(q.take(GAP_MS)).toBeNull()
  })

  it('копит не больше трёх: выбрасывает самую неважную', () => {
    const q = new VoiceQueue()
    q.push(item('playing', 1))
    q.take(0)
    q.push(item('r', 1))
    q.push(item('s1', 3))
    q.push(item('s2', 3))
    q.push(item('h', 2))
    q.done(0)
    const order: string[] = []
    for (let t = GAP_MS; t < GAP_MS * 10; t += GAP_MS) {
      const it = q.take(t)
      if (it) {
        order.push(it.id)
        q.done(t)
      }
    }
    expect(order).toEqual(['s1', 's2', 'h'])
  })
})
