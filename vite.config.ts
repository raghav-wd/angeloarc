import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative assets work on both a GitHub project site and a custom/root domain.
  base: './',
  plugins: [react()],
})
