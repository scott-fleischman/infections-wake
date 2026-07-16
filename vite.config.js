import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // relative asset URLs so the build works at any mount point (GitHub Pages
  // serves from /<repo>/)
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: r('index.html'),
        gallery: r('gallery.html'),
        docs: r('docs.html'),
      },
    },
  },
});
