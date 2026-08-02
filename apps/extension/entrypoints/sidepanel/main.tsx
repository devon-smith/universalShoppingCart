import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SidePanelApp } from './SidePanelApp';
import './style.css';

const container = document.querySelector('#root');
if (!container) {
  throw new Error('Side panel root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>,
);
