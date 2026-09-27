// 패키지에 들어 있는 파일을 public/으로 복사한다 (dev, build, test 전에 자동 실행)
//  - @spotify/basic-pitch의 공식 모델 → public/models/basic-pitch/
//  - coi-serviceworker (GitHub Pages에서 교차 출처 격리를 켜 WebAssembly 멀티스레드를 쓰게 함) → public/
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pkg = dirname(require.resolve('@spotify/basic-pitch/package.json'));
const out = join(pub, 'models', 'basic-pitch');
mkdirSync(out, { recursive: true });
for (const f of ['model/model.json', 'model/group1-shard1of1.bin', 'LICENSE']) {
  copyFileSync(join(pkg, f), join(out, f.split('/').pop()));
}
console.log('Basic Pitch 모델 복사 →', out);

const coi = dirname(require.resolve('coi-serviceworker/package.json'));
copyFileSync(join(coi, 'coi-serviceworker.min.js'), join(pub, 'coi-serviceworker.js'));
console.log('coi-serviceworker 복사 →', pub);
