import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import PlatformConsole from './components/PlatformConsole';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/^\/platform\/?$/.test(window.location.pathname) ? <PlatformConsole /> : <App />}
  </StrictMode>,
);
