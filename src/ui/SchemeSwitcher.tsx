import { useEffect, useState } from 'react'
import { control } from '../shared/controlState'
import { onSchemeChange, SCHEMES, setScheme } from '../shared/schemes'

/**
 * Переключатель схемы ходьбы в углу экрана — мышкой, для сравнения режимов на тестах.
 * В самой игре схему можно сменить и жестами: меню (две ладони) → «Ходьба: …».
 */
export function SchemeSwitcher() {
  const [current, setCurrent] = useState(control.scheme)
  useEffect(() => onSchemeChange(setCurrent), [])
  return (
    <div className="scheme-switch" role="group" aria-label="Схема ходьбы">
      <span className="scheme-switch__label">ходьба:</span>
      {SCHEMES.map((s, i) => (
        <button key={s.id} className={s.id === current ? 'is-on' : ''} onClick={() => setScheme(s.id)}>
          {i + 1}. {s.title}
        </button>
      ))}
    </div>
  )
}
