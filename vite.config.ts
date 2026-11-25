import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// The app version is baked into the build (src/lib/version.ts reads __POWDOCK_VERSION__).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig(({ command }) => ({
  server: { port: 3434 },
  resolve: { tsconfigPaths: true },
  // The production server bundles every dependency, so the Docker image needs no node_modules.
  // Dev keeps dependencies external: CommonJS packages such as react cannot run inside the dev SSR module runner.
  ssr: command === 'build' ? { noExternal: true } : {},
  define: { __POWDOCK_VERSION__: JSON.stringify(version) },
  // Vite leaves the server build unminified by default; minify it too, it ships in the image and the npm package.
  build: { minify: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    // a component the compiler bails out of would ship unmemoized, so it fails the build instead
    babel({
      presets: [reactCompilerPreset({ panicThreshold: 'all_errors' })],
    }),
  ],
}))
