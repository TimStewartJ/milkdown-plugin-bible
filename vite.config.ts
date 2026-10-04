import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [/^@milkdown\//, /^@floating-ui\//],
    },
    minify: false,
    sourcemap: true,
  },
  plugins: [
    {
      name: 'copy-stylesheet',
      apply: 'build',
      closeBundle: () => copyFile('src/style.css', 'dist/style.css'),
    },
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
