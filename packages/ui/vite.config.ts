import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// The dev-only demo page is kept out of builds by import.meta.env.DEV. That flag follows the command, not NODE_ENV,
// so a shell with NODE_ENV=development cannot put the demo into a production build.
export default defineConfig(({ command }) => ({
  root,
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  define: { 'import.meta.env.DEV': JSON.stringify(command === 'serve') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))
