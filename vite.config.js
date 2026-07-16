import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the same build works both on Vercel (served at /)
  // and bundled into the native app (loaded from the app's local origin).
  base: './',
  plugins: [react()],
})
