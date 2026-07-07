import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/**
 * Vite/React entry point. Mounts the app via the React 18 concurrent-mode
 * root API. Assumes index.html defines a <div id="root">.
 * Wrapped in a Fragment (rather than <React.StrictMode>) so no extra
 * double-invocation of effects occurs in development.
 */
createRoot(document.getElementById('root')).render(
  <>
    <App />
  </>
)
