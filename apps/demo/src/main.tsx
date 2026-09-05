import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// TR-06 — a real customer would paste this one line into their app. With no
// `?tour=` in the URL it reads the query string and returns, touching nothing;
// see the no-parameter contract at the top of that file.
import './tour-bootstrap.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
