import { createRoot } from 'react-dom/client'
import { App } from './App'
import { HoloLab } from './game/holo/HoloLab'
import { SpiritLab } from './game/spirit/SpiritLab'
import { runtime } from './game/runtime'
import { voiceNow } from './game/voice'
import { control } from './shared/controlState'
import { useGame } from './shared/gameStore'
import './styles.css'

// Режим ?debug: данные распознавания и игры доступны снаружи (для отладки на живой камере).
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __control: control, __game: useGame, __runtime: runtime, __voice: voiceNow })

// Стенды — отдельно от игры: голограмма руки (`?holo`), запись жестов (`?record`), дух Окна (`?spirit`).
const params = new URLSearchParams(location.search)
const root = params.has('spirit') ? (
  <SpiritLab />
) : params.has('holo') || params.has('record') ? (
  <HoloLab record={params.has('record')} />
) : (
  <App />
)
createRoot(document.getElementById('root')!).render(root)
