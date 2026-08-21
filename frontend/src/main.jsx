import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'

// The service worker (sw.js) calls skipWaiting()/clients.claim() so a new
// deploy takes over immediately in the background — but the page that's
// already open keeps running the OLD JS bundle in memory until it reloads.
// Without this, users can sit on a stale build (old CSS/JS) indefinitely,
// especially in the installed PWA where the app rarely gets a fresh navigation.
if ('serviceWorker' in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  // Standalone/PWA sessions can stay open for a long time without a normal
  // navigation, so the browser's own periodic update check may lag behind a
  // fresh deploy. Nudge it to check whenever the app is brought back to the
  // foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then((reg) => reg?.update());
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <LanguageProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </LanguageProvider>
)
