import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// Isolated rendering harness. GraphQL is fulfilled by the test runner, never a real API.
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  envDir: false,
  define: { 'process.env.NEXT_PUBLIC_GRAPHQL_URL': JSON.stringify('/__test/graphql') },
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: process.env.TRIPDOCK_BROWSER_BASELINE ? [{
      find: '../../components/trip-dock-app',
      replacement: fileURLToPath(new URL('../../../../.cache/baseline-web/components/trip-dock-app.tsx', import.meta.url)),
    }] : [],
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 3312, strictPort: true },
});
await server.listen();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
