import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { DemoSessionProvider } from './demo/session';
import './i18n';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <DemoSessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DemoSessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
