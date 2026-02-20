import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isRustDebugBuild = mode === 'rust-debug'

  return {
    plugins: [
      vue(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        disable: isRustDebugBuild,
        // Avoid updating SW mid-session: a new SW activating while an old bundle is
        // still running can break lazy-loaded route chunks.
        registerType: 'prompt',
        // We use `virtual:pwa-register` in src/main.ts.
        injectRegister: false,
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,otf,eot,webmanifest}'],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          // iOS is more reliable with classic SW format.
          rollupFormat: 'iife',
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
        manifest: {
          name: 'OpenCode Studio',
          short_name: 'OCS',
          start_url: '/',
          display: 'standalone',
          background_color: '#101415',
          theme_color: '#101415',
          orientation: 'portrait-primary',
          icons: [
            {
              src: '/logo-dark.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
            {
              src: '/apple-touch-icon-180x180.png',
              sizes: '180x180',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/apple-touch-icon-152x152.png',
              sizes: '152x152',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/favicon-32.png',
              sizes: '32x32',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/favicon-16.png',
              sizes: '16x16',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
      }),
    ],
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
