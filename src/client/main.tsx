import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import App from './App';
import { phoneApp } from './phone';
import './styles.css';
import './roomEffects.css';
import './controlStyles.css';
import './landscapeThemes.css';
import './themeArtDirection.css';
import './mobileShell.css';
import './collectionSurfaces.css';
import './themeDetails.css';
import './themeFrames.css';
import './harborTheme.css';
import './stageDock.css';
import './arcadeTheme.css';

document.documentElement.dataset.visualRelease = '0.7.2';

if (import.meta.env.PROD && !phoneApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(() => undefined);
  });
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

async function start() {
  if (phoneApp) await (await import('../phone/backend')).startPhoneBackend();
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

start().catch(error => {
  console.error(error);
  root.render(<p style={{ padding: 24, color: '#fff' }}>音乐小屋启动失败：{error instanceof Error ? error.message : String(error)}</p>);
});
