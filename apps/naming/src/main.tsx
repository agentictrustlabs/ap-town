import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { completeRedirectIfReturning, hasPendingCeremony, relayedToOpener, takeHomeReturn } from './session';
import '@ap-town/town-ui/base.css';

const render = () => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
const search = new URLSearchParams(window.location.search);

if (hasPendingCeremony(search.get('state'))) {
  // Back from the Home's full-page ceremony: finish it (the session lands in storage), then draw the page it returns to.
  completeRedirectIfReturning().catch(() => null).finally(render);
} else if (search.get('registered') && search.get('popup') === '1' && takeHomeReturn(search)) {
  // The Home's ceremony landed and sent its popup back here: the result is relayed to the opener and this window
  // closes. Should it stay open (not a popup after all), it shows the new name like any page.
  document.getElementById('root')!.innerHTML = '<p style="font:15px system-ui;padding:24px">Registered. You can close this window.</p>';
  window.setTimeout(() => { if (!window.closed) { window.history.replaceState({}, '', `/name/${encodeURIComponent(search.get('registered')!)}?just=1`); render(); } }, 1200);
} else if (relayedToOpener(search)) {
  // This window is the popup's own return leg (COOP severed the opener): the code was relayed; the opener finishes.
  window.setTimeout(() => { window.history.replaceState({}, '', window.location.pathname); render(); }, 700);
} else {
  takeHomeReturn(search);
  render();
}
