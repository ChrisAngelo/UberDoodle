import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * SECURITY NOTE - GEMINI_API_KEY
 * The key below is injected with `define`, i.e. string-replaced into the
 * client bundle at build time. Anyone who can load the built app (or dist/)
 * can read it. This is acceptable ONLY for local, single-user use. Never
 * deploy a build made with a real key to a public host; for that, move Gemini
 * calls behind a server (e.g. main.py) and keep the key server-side.
 * Only GEMINI_API_KEY / API_KEY are exposed - no other env vars are defined.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const key = env.GEMINI_API_KEY || env.API_KEY || '';
  return {
    server: {
      port: 5173,
      // Localhost by default; set VITE_HOST=0.0.0.0 to expose on your LAN
      // (note: that also exposes the bundled API key to the LAN).
      host: env.VITE_HOST || '127.0.0.1',
      strictPort: false,
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(key),
      'process.env.GEMINI_API_KEY': JSON.stringify(key),
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (id.includes('@google/genai')) return 'genai';
            if (/[\\/]node_modules[\\/](jszip|pako|lie|setimmediate|readable-stream)[\\/]/.test(id)) return 'jszip';
            if (id.includes('lucide-react')) return 'lucide';
            return 'vendor';
          },
        },
      },
    },
  };
});
