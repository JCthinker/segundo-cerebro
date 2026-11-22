import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { Capture } from './Capture'

const isCapture = window.location.hash === '#capture'
if (isCapture) document.body.style.background = 'transparent'

createRoot(document.getElementById('root')!).render(<StrictMode>{isCapture ? <Capture /> : <App />}</StrictMode>)
