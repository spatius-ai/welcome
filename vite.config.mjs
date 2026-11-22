import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

// The avatar engine loads its .wasm file at run time, so the bundler never sees it.
// Copy it next to the built code.
const copyAvatarWasm = () => ({
  name: 'copy-avatar-wasm',
  closeBundle() {
    const src = resolve(here, 'node_modules/@spatius/avatarkit/dist');
    if (!existsSync(src)) throw new Error('Run "npm install" first: @spatius/avatarkit is missing.');
    const out = resolve(here, 'dist/assets');
    mkdirSync(out, { recursive: true });
    for (const f of readdirSync(src)) if (f.endsWith('.wasm')) copyFileSync(join(src, f), join(out, f));
  },
});

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  optimizeDeps: { exclude: ['@spatius/avatarkit'] },
  plugins: [copyAvatarWasm()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
