/** Состояние стенда голограммы (`?holo`): клавиши и Recorder меняют, сцена читает каждый кадр. */
export type View = 'hero' | 'sky' | 'stone'

export const labState = {
  view: 'hero' as View,
  low: false,
  paused: false,
  zoom: 1,
  /** Свежая запись из Recorder — показать её следующей. */
  pin: null as string | null,
}
