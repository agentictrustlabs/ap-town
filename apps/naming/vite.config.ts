import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `pnpm dev` serves the app and proxies /api to `wrangler dev --port 8791` (the Worker, reading the real chain
// through the gateway with the token in .dev.vars).
export default defineConfig({
  plugins: [react()],
  server: { port: 5873, proxy: { '/api': 'http://localhost:8791' } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
