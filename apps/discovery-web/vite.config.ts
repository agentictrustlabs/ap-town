import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build modes: `vite build` (production — the Base Sepolia workers.dev discovery agent, the default in
// src/lib/discovery-a2a.ts) and `vite build --mode faithnet` (the parallel faithnet universe on
// discovery.faithnet.io → discovery-a2a.faithnet.io). Mode config lives HERE (tracked) rather than in a
// `.env.faithnet` file, which the repo's .gitignore would drop.
const MODE_DEFINES: Record<string, Record<string, string>> = {
  faithnet: {
    VITE_DISCOVERY_A2A_URL: 'https://discovery-a2a.faithnet.io',
    VITE_DISCOVERY_CHAIN_LABEL: 'faithchain (34348)',
    VITE_DISCOVERY_AGENT_NAME: 'discovery.registry',
    VITE_DISCOVERY_REGISTRY_ADDRESS: '0x1791316684f08ca7158c639C528980d780B47051',
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Distinct from demo-web (5173) / demo-web-pro (5273) / demo-sso (5373) /
  // demo-org (5473) / demo-jp (5573) / demo-gs (5673).
  server: { port: 5773 },
  define: Object.fromEntries(Object.entries(MODE_DEFINES[mode] ?? {}).map(([k, val]) => [`import.meta.env.${k}`, JSON.stringify(val)])),
}));
