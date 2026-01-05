import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // استيراد التدوينة

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // إضافة التدوينة هنا
  ],
})