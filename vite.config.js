import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: r('index.html'),
        gallery: r('gallery.html'),
      },
    },
  },
});
