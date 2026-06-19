import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Distinct from demo-web (5173) / demo-web-pro (5273) / demo-sso (5373) /
  // demo-org (5473) / demo-jp (5573) / demo-gs (5673).
  server: { port: 5773 },
});
