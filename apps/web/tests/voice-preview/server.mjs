import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  envDir: false,
  define: { 'process.env.NEXT_PUBLIC_GRAPHQL_URL': JSON.stringify('/__voice-preview/graphql') },
  plugins: [react()],
  resolve: { alias: [{ find: /\.\.\/lib\/live-recognition$/, replacement: fileURLToPath(new URL('./simulated-live.ts', import.meta.url)) }] },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 3201, strictPort: true },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
