import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built into the Next app's public/ folder and served from /fnb3d/, so one deployment carries both.
export default defineConfig({
  plugins: [react()],
  base: '/fnb3d/',
  build: { outDir: '../public/fnb3d', emptyOutDir: true },
  server: { port: 5183 },
});
