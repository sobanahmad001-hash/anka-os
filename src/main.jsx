import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { OrganizationProvider } from './context/OrganizationContext.jsx';
import { ThemeProvider } from './hooks/useTheme.jsx';
import './index.css';

const CHUNK_RELOAD_KEY = 'anka:last-chunk-reload'

window.addEventListener('vite:preloadError', (event) => {
  const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
  if (Date.now() - lastReload > 60_000) {
    event.preventDefault()
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OrganizationProvider>
          <ThemeProvider>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </ThemeProvider>
        </OrganizationProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

