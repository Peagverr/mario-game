// Публикует собранную игру (dist/) на GitHub Pages: https://peagverr.github.io/mario-game/
// Запуск: npm run deploy (сначала собирает, потом загружает в ветку gh-pages).
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const run = (cmd) => execSync(cmd, { cwd: 'dist', stdio: 'inherit' })
const remote = execSync('git remote get-url origin').toString().trim()

writeFileSync('dist/.nojekyll', '')
rmSync('dist/.git', { recursive: true, force: true })
run('git init -q -b gh-pages')
run('git add -A')
run(`git commit -q -m "Сборка сайта ${new Date().toISOString()}"`)
run(`git push -q -f ${remote} gh-pages`)
rmSync('dist/.git', { recursive: true, force: true })
console.log('Готово: https://peagverr.github.io/mario-game/ (обновится через 1–2 минуты)')
