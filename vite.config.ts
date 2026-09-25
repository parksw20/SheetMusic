/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // iPad에서 마이크를 쓰려면 HTTPS가 필요하다: npm run dev:ipad
  plugins: [react(), mode === 'ipad' && basicSsl()],
  // OpenSheetMusicDisplay가 커서 경고 기준을 넘는다
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'jsdom',
  },
}));
