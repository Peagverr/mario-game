/**
 * One Euro Filter (Casiez и др., 2012) — сглаживание дрожания.
 * В покое сглаживает сильно (рука не трясётся), при быстром движении почти не тормозит.
 * minCutoff: меньше → меньше дрожания в покое; beta: больше → меньше задержки при быстром движении.
 */
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  constructor(
    private minCutoff = 1.2,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, timeMs: number): number {
    if (this.x === null) {
      this.x = value
      this.t = timeMs
      return value
    }
    const dt = Math.max(1e-3, (timeMs - this.t) / 1000)
    this.t = timeMs
    const rawDx = (value - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x)
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}

/** Набор фильтров для точки x/y/z. */
export class OneEuro3 {
  private fx: OneEuro
  private fy: OneEuro
  private fz: OneEuro

  constructor(minCutoff?: number, beta?: number) {
    this.fx = new OneEuro(minCutoff, beta)
    this.fy = new OneEuro(minCutoff, beta)
    this.fz = new OneEuro(minCutoff, beta)
  }

  filter(p: { x: number; y: number; z: number }, t: number) {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t), z: this.fz.filter(p.z, t) }
  }

  reset() {
    this.fx.reset()
    this.fy.reset()
    this.fz.reset()
  }
}
