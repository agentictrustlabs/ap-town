import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { completeRedirectIfReturning, hasPendingCeremony, relayedToOpener } from './session';
import '@ap-town/town-ui/base.css';

const render = () => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
const search = new URLSearchParams(window.location.search);

if (hasPendingCeremony(search.get('state'))) {
  // Back from the Home's full-page ceremony: finish it (the session lands in storage), then draw the page it returns to.
  completeRedirectIfReturning().catch(() => null).finally(render);
} else if (relayedToOpener(search)) {
  // This window is the popup's own return leg (COOP severed the opener): the code was relayed; the opener finishes.
  window.setTimeout(() => { window.history.replaceState({}, '', window.location.pathname); render(); }, 700);
} else {
  render();
}
