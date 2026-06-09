import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react-oxc';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    minify: 'esbuild',
    sourcemap: true,
  },
});
