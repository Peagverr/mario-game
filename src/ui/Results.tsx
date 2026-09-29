import { useMemo } from 'react'
import { ERROR_ADVICE } from '../input/errors'
import type { HintCode } from '../shared/controlState'
import { levelInfo, nextLevel } from '../game/scenes'
import { computeScore, runSeconds, useGame } from '../shared/gameStore'
import { DwellButton } from './Dwell'
import { randomName, saveRecord } from './leaderboard'

const savedRuns = new Map<number, { top: ReturnType<typeof saveRecord>['top']; place: number; name: string }>()

/** «1 раз», «2 раза», «5 раз». */
function times(n: number) {
  const d = n % 10
  const dd = n % 100
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'раза' : 'раз'
}

/**
 * Итоги: счёт, точность жестов, разбор ошибок с советами и таблица рекордов.
 */
export function Results() {
  const g = useGame()
  const seconds = runSeconds(g)
  const score = computeScore(g.starsCollected, seconds, g.falls)

  // Сохраняем результат забега ровно один раз, даже если экран отрисуется повторно.
  const { top, place, name } = useMemo(() => {
    const saved = savedRuns.get(g.startedAt)
    if (saved) return saved
    const name = randomName()
    const result = { ...saveRecord(g.sceneId, { name, score, stars: g.starsCollected, seconds, at: Date.now() }), name }
    savedRuns.set(g.startedAt, result)
    return result
  }, [g.startedAt])

  const next = nextLevel(g.sceneId)
  const errors = Object.entries(g.stats.errors) as [HintCode, number][]
  errors.sort((a, b) => b[1] - a[1])
  const gestureErrors = (['fist-partial', 'pinch-partial', 'point-partial'] as const).reduce((a, c) => a + (g.stats.errors[c] ?? 0), 0)
  const attempts = g.stats.jumps + gestureErrors
  const accuracy = attempts ? Math.round((g.stats.jumps / attempts) * 100) : 100

  return (
    <div className="screen screen--dim">
      <div className="card card--results">
        <p className="eyebrow">Уровень «{levelInfo(g.sceneId)?.title ?? ''}» пройден</p>
        <h2 className="title title--small">{score} очков</h2>
        <div className="stats">
          <div><b>{g.starsCollected}/{g.starsTotal}</b><span>звёзд</span></div>
          <div><b>{seconds.toFixed(1)} с</b><span>время</span></div>
          <div><b>{accuracy}%</b><span>точность жестов</span></div>
          <div><b>{g.falls}</b><span>падений</span></div>
        </div>

        <div className="results__cols">
          <section>
            <h3>Разбор ошибок</h3>
            {errors.length === 0 ? (
              <p className="fine">Ни одной ошибки в жестах — чисто!</p>
            ) : (
              <ul className="errors">
                {errors.slice(0, 3).map(([code, n]) => (
                  <li key={code}>
                    <b>{ERROR_ADVICE[code].title}</b> — {n} {times(n)}
                    <span>{ERROR_ADVICE[code].tip}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Рекорды</h3>
            <ol className="board">
              {top.map((r, i) => (
                <li key={r.at} className={i === place ? 'is-me' : ''}>
                  <span>{r.name}{i === place ? ' (ты)' : ''}</span>
                  <b>{r.score}</b>
                </li>
              ))}
            </ol>
            {place === -1 && <p className="fine">Ты — {name}. До таблицы не хватило совсем чуть-чуть.</p>}
          </section>
        </div>

        <div className="row">
          {next && <DwellButton onActivate={() => g.goToScene(next.id)}>Дальше: {next.title}</DwellButton>}
          <DwellButton variant={next ? 'ghost' : 'primary'} onActivate={() => g.restart()}>
            Сыграть ещё
          </DwellButton>
          <DwellButton variant="ghost" onActivate={() => g.goToScene('lobby')}>
            В лобби
          </DwellButton>
        </div>
      </div>
    </div>
  )
}
