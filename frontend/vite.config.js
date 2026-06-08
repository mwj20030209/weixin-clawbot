import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: true,
    port: 5177,
    proxy: {
      '/api': {
        target: 'http://localhost:8849',
        changeOrigin: true,
      },
    },
  },
})
