import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 設為相對路徑，部署到 GitHub Pages 子目錄也能用
export default defineConfig({
  base: './',
  plugins: [vue()],
})
