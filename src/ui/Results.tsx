import { useMemo } from 'react'
import { useT } from '../i18n'
import { errorAdvice } from '../input/errors'
import type { HintCode } from '../shared/controlState'
import { levelInfo, nextLevel } from '../game/scenes'
import { computeScore, runSeconds, useGame } from '../shared/gameStore'
import { DwellButton } from './Dwell'
import { randomName, saveRecord } from './leaderboard'

const savedRuns = new Map<number, { top: ReturnType<typeof saveRecord>['top']; place: number; name: string }>()

/**
 * Итоги: счёт, точность жестов, разбор ошибок с советами и таблица рекордов.
 */
export function Results() {
  const g = useGame()
  const tr = useT()
  const s = tr.results
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

  const level = levelInfo(g.sceneId)
  const next = nextLevel(g.sceneId)
  const errors = Object.entries(g.stats.errors) as [HintCode, number][]
  errors.sort((a, b) => b[1] - a[1])
  const gestureErrors = (['fist-partial'] as const).reduce((a, c) => a + (g.stats.errors[c] ?? 0), 0)
  const attempts = g.stats.jumps + gestureErrors
  const accuracy = attempts ? Math.round((g.stats.jumps / attempts) * 100) : 100

  return (
    <div className="screen screen--dim">
      <div className="card card--results">
        <p className="eyebrow">{s.complete(level ? tr.levels[level.id].title : '')}</p>
        <h2 className="title title--small">{s.points(score)}</h2>
        <div className="stats">
          <div><b>{g.starsCollected}/{g.starsTotal}</b><span>{s.stars}</span></div>
          <div><b>{seconds.toFixed(1)} {s.sec}</b><span>{s.time}</span></div>
          <div><b>{accuracy}%</b><span>{s.accuracy}</span></div>
          <div><b>{g.falls}</b><span>{s.falls}</span></div>
        </div>

        <div className="results__cols">
          <section>
            <h3>{s.review}</h3>
            {errors.length === 0 ? (
              <p className="fine">{s.clean}</p>
            ) : (
              <ul className="errors">
                {errors.slice(0, 3).map(([code, n]) => (
                  <li key={code}>
                    <b>{errorAdvice(code).title}</b>{s.count(n)}
                    <span>{errorAdvice(code).tip}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>{s.records}</h3>
            <ol className="board">
              {top.map((r, i) => (
                <li key={r.at} className={i === place ? 'is-me' : ''}>
                  <span>{r.name}{i === place ? s.you : ''}</span>
                  <b>{r.score}</b>
                </li>
              ))}
            </ol>
            {place === -1 && <p className="fine">{s.missed(name)}</p>}
          </section>
        </div>

        <div className="row">
          {next && <DwellButton onActivate={() => g.goToScene(next.id)}>{s.next(tr.levels[next.id].title)}</DwellButton>}
          <DwellButton variant={next ? 'ghost' : 'primary'} onActivate={() => g.restart()}>
            {s.again}
          </DwellButton>
          <DwellButton variant="ghost" onActivate={() => g.goToScene('lobby')}>
            {s.lobby}
          </DwellButton>
        </div>
      </div>
    </div>
  )
}
