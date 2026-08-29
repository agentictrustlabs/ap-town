import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build modes: `vite build` (production — the Base Sepolia workers.dev discovery agent, the default in
// src/lib/discovery-a2a.ts) and `vite build --mode faithnet` (the parallel faithnet universe on
// discovery.faithnet.io → discovery-a2a.faithnet.io). Mode config lives HERE (tracked) rather than in a
// `.env.faithnet` file, which the repo's .gitignore would drop.
const A2A_URL_BY_MODE: Record<string, string | undefined> = {
  faithnet: 'https://discovery-a2a.faithnet.io',
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Distinct from demo-web (5173) / demo-web-pro (5273) / demo-sso (5373) /
  // demo-org (5473) / demo-jp (5573) / demo-gs (5673).
  server: { port: 5773 },
  define: A2A_URL_BY_MODE[mode]
    ? { 'import.meta.env.VITE_DISCOVERY_A2A_URL': JSON.stringify(A2A_URL_BY_MODE[mode]) }
    : {},
}));
