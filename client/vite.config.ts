import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_API_URL || 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_DOMAIN__: JSON.stringify(process.env.APP_DOMAIN || 'myapp.jtlapp.net'),
  },
  server: {
    proxy: {
      '/api': apiTarget,
    },
  },
})
