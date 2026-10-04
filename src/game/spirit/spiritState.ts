/**
 * Дух Окна — видимое воплощение голоса. Маленький API для игры и обучения (как runtime: меняется на месте,
 * сцена читает каждый кадр). Счётчики *Seq: дух реагирует, когда число выросло.
 *
 *   spiritAppear() / spiritVanish()   — появиться из искр / рассыпаться;
 *   spiritGuide(точка, секунды)       — слетать к точке мира, оставляя светлый след, и мерцать там;
 *   spiritFollow()                    — вернуться к плечу героя (по умолчанию);
 *   spiritCelebrate()                 — радостная петля с искрами (шаг выполнен, звезда найдена);
 *   spiritAlert()                     — короткий тёплый оттенок (подсказка об ошибке).
 * Прыжок героя дух подхватывает сам — взлетает вместе с ним со следом.
 */
export const spirit = {
  present: false,
  mode: 'follow' as 'follow' | 'guide',
  guide: { x: 0, y: 0, z: 0 },
  /** Сколько секунд висеть у точки, 0 — пока не позовут обратно. */
  guideSeconds: 0,
  guideSeq: 0,
  celebrateSeq: 0,
  alertSeq: 0,
  /** Сколько света вернулось к духу (сюжет: каждый пройденный уровень — светлее). 1 — обычный вид. */
  light: 1,
}

export function spiritAppear() {
  spirit.present = true
}

export function spiritVanish() {
  spirit.present = false
}

export function spiritGuide(to: { x: number; y: number; z: number }, seconds = 0) {
  spirit.mode = 'guide'
  spirit.guide.x = to.x
  spirit.guide.y = to.y
  spirit.guide.z = to.z
  spirit.guideSeconds = seconds
  spirit.guideSeq++
}

export function spiritFollow() {
  spirit.mode = 'follow'
}

export function spiritCelebrate() {
  spirit.celebrateSeq++
}

export function spiritAlert() {
  spirit.alertSeq++
}

/** Сколько света у духа: 1 — обычный вид, меньше — тусклее, больше — ярче. */
export function spiritLight(v: number) {
  spirit.light = v
}
