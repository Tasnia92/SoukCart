import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import App from './App.tsx'
import { applySidebarSide } from '@/lib/utils'

applySidebarSide()
if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => applySidebarSide())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
