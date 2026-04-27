import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

function mount(): void {
  const el = document.getElementById('root');
  if (!el) throw new Error('Root element #root not found');
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

function hasOffice(): boolean {
  return typeof (globalThis as { Office?: unknown }).Office !== 'undefined';
}

if (hasOffice()) {
  void Office.onReady(() => {
    mount();
  });
} else {
  // Dev in a plain browser (Vite preview outside of Word).
  mount();
}
