/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // OpenSheetMusicDisplay가 커서 경고 기준을 넘는다
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'jsdom',
  },
});
