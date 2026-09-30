import { createRoot } from 'react-dom/client'
import { App } from './App'
import { runtime } from './game/runtime'
import { control } from './shared/controlState'
import { useGame } from './shared/gameStore'
import './styles.css'

// Режим ?debug: данные распознавания и игры доступны снаружи (для отладки на живой камере).
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __control: control, __game: useGame, __runtime: runtime })

createRoot(document.getElementById('root')!).render(<App />)
