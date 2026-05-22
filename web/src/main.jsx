// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <>
    <title>Thai Fire Management System</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta charSet="UTF-8" />
    <meta name="description" content="A web application for managing and monitoring fire incidents in Thailand." />
    <meta name="keywords" content="fire management, Thailand, web application, monitoring, incident management" />
    <App />
  </>
)
