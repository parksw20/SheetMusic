/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// 화면에 보여 줄 버전 정보: package.json 버전 + git 커밋 + 빌드 시각
const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
let commit = 'dev';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // git이 없는 환경
}
const builtAt = new Date().toISOString();

/** 빌드 결과에 version.json을 넣는다. 앱이 이 파일을 읽어 새 버전이 배포됐는지 확인한다 */
const versionFile: Plugin = {
  name: 'version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, commit, builtAt }) });
  },
};

/**
 * TensorFlow.js WebAssembly 멀티스레드 수정.
 * tfjs는 모델 실행 함수를 문자열로 바꿔(toString) 보조 스레드(Worker)에 넘긴다. 이 함수는 바깥의 _scriptDir 변수를
 * 쓰는데, 압축(minify)하면 이름이 바뀌어(e 등) 보조 스레드에서 "e is not defined"로 죽는다.
 * _scriptDir을 함수 안에서 선언해 문자열만으로도 돌게 한다. 브라우저에서는 어차피 undefined라 동작은 같다.
 */
const tfjsWasmThreadsFix: Plugin = {
  name: 'tfjs-wasm-threads-fix',
  transform(code, id) {
    if (!id.includes('tfjs-backend-wasm-threaded-simd.js')) return null;
    const head = 'function(WasmBackendModuleThreadedSimd) {\n';
    if (!code.includes(head)) this.error('tfjs-backend-wasm 구조가 바뀌었습니다: tfjsWasmThreadsFix를 확인하세요');
    return code.replace(
      head,
      head + "  var _scriptDir = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : undefined;\n",
    );
  },
};

export default defineConfig(({ mode }) => ({
  // iPad에서 마이크를 쓰려면 HTTPS가 필요하다: npm run dev:ipad
  plugins: [react(), versionFile, tfjsWasmThreadsFix, mode === 'ipad' && basicSsl()],
  // AI 인식은 Web Worker(aiWorker.ts)에서 돌아서 Worker 번들에도 넣는다
  worker: { format: 'es', plugins: () => [tfjsWasmThreadsFix] },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  // 상대 경로로 빌드해서 GitHub Pages(https://<id>.github.io/SheetMusic/) 같은 하위 경로에서도 동작하게 한다
  base: './',
  // OpenSheetMusicDisplay가 커서 경고 기준을 넘는다
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'jsdom',
  },
}));
