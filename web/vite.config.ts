import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isRustDebugBuild = mode === 'rust-debug'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    esbuild: isRustDebugBuild ? { keepNames: true } : undefined,
    build: {
      // Monaco workers are intentionally large and lazy-loaded; keep build output noise low.
      chunkSizeWarningLimit: 8192,
      outDir: isRustDebugBuild ? 'dist-rust-debug' : 'dist',
      minify: isRustDebugBuild ? false : 'esbuild',
      cssMinify: isRustDebugBuild ? false : undefined,
      sourcemap: isRustDebugBuild ? true : false,
    },
  }
})
