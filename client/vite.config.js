import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bar:  resolve(__dirname, 'bar.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
})
