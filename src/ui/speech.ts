/**
 * Озвучка подсказок встроенным синтезом речи браузера (русский голос, если он есть в системе).
 * Если голоса нет — просто молчим, текст подсказки всё равно на экране.
 */
let lastSpoken = 0
let voice: SpeechSynthesisVoice | null | undefined

function pickVoice() {
  if (voice !== undefined) return voice
  const voices = window.speechSynthesis?.getVoices() ?? []
  if (!voices.length) return null
  voice = voices.find((v) => v.lang.toLowerCase().startsWith('ru')) ?? null
  return voice
}

export function speak(text: string, minGapMs = 3500) {
  const synth = window.speechSynthesis
  if (!synth) return
  const now = performance.now()
  if (now - lastSpoken < minGapMs) return
  const v = pickVoice()
  if (!v) return
  lastSpoken = now
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = v
  u.lang = v.lang
  u.rate = 1.08
  synth.speak(u)
}
