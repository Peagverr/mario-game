import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Относительные пути: сайт работает и на localhost, и на GitHub Pages (/mario-game/).
  base: './',
  server: { port: 5173 },
})
