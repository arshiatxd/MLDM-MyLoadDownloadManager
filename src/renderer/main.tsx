import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CompactDownloadFrame } from './components/CompactDownloadFrame';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const params = new URLSearchParams(window.location.search);
const isCompactPopup = params.get('view') === 'popup';
const popupSessionId = params.get('session') ?? '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isCompactPopup && popupSessionId ? (
        <CompactDownloadFrame sessionId={popupSessionId} />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>
);

