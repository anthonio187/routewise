import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App';
import { I18nProvider } from './i18n';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyInitialTheme } from './lib/theme';

// Apply the stored theme before the first paint to avoid a flash.
applyInitialTheme();

// Warm the map style during idle time. The style document (tiles, fonts,
// sprite URLs) is the slowest single request before the first rendered tile,
// and the planner only creates the map after the first search.
window.setTimeout(() => {
  const style =
    (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
    'https://tiles.openfreemap.org/styles/liberty';
  void fetch(style, { mode: 'cors', credentials: 'omit' }).catch(() => undefined);
}, 1200);

// Fetch the lazily-split map chunk once the page is idle. It does not block
// first paint, and it means the map appears the moment results arrive.
window.setTimeout(() => {
  void import('./components/MapView').catch(() => undefined);
}, 2500);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Offline shell: registered only in production builds so development stays fresh.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration never blocks the app.
    });
  });
}
