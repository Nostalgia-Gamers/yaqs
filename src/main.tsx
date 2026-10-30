import '@fontsource-variable/inter'
import '@fontsource/jost/700.css'
import '@fontsource/jost/800.css'
import '@fontsource/jetbrains-mono/400.css'
import './app.css'
import './ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startLive } from './lib/live'
import { startAlerts } from './lib/alerts'
import { startUpdater } from './lib/updater'

startLive()
startAlerts()
startUpdater()

// No browser-style Back/Refresh/Inspect menu; text fields keep copy/paste.
document.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement).closest('input, textarea, .selectable')) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
