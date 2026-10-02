import type { RapierRigidBody } from '@react-three/rapier'
import { Vector3 } from 'three'

/**
 * Общие данные игры, которые меняются каждый кадр (без React-состояния).
 * Игрок пишет свою позицию, камера по ней следует, уровень регистрирует чекпоинты и движущиеся платформы.
 */
export const runtime = {
  playerPos: new Vector3(0, 1, 0),
  playerVel: new Vector3(),
  /** Поворот камеры вокруг мира (радианы) — чтобы «вправо на экране» было вправо для героя. */
  cameraYaw: 0,
  /** Коллайдер → точка возрождения. */
  checkpoints: new Map<number, Vector3>(),
  /** Коллайдер движущейся платформы → её текущая скорость. */
  movers: new Map<number, Vector3>(),
  /** Очередь всплесков частиц (сбор звезды, приземление). */
  bursts: [] as { pos: Vector3; color: string; count: number; speed: number }[],
  /** Тело героя — чтобы лучи «видно ли звезду» не упирались в самого героя. */
  playerBody: null as RapierRigidBody | null,
  /** Во сколько раз шире обзор в этой сцене (лобби показывает больше, уровни — ближе). */
  viewScale: 1,
  /** После возрождения герой стоит, пока игрок не сменит жест. */
  moveLocked: false,
  /** Тряска камеры, 0..1, затухает сама. */
  shake: 0,
  /** Слабый ноутбук (PerformanceMonitor снизил качество) — эффекты экономнее: меньше частиц у голограммы. */
  lowQuality: false,
}

export function burst(pos: Vector3, color: string, count = 14, speed = 4) {
  runtime.bursts.push({ pos: pos.clone(), color, count, speed })
}
