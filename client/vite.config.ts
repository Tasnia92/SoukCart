import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import path from 'path'

// Match the API's PORT precedence: shell, server/.env, then root .env.
let port = process.env.PORT
for (const file of ['../server/.env', '../.env']) {
  const envPath = path.resolve(import.meta.dirname, file)
  if (port === undefined && existsSync(envPath)) {
    port = parseEnv(readFileSync(envPath, 'utf8')).PORT
  }
}
const apiTarget = `http://localhost:${port || 5001}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/uploads': apiTarget,
    },
  },
})
