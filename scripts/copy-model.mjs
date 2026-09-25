// @spotify/basic-pitch 패키지에 들어 있는 공식 모델 파일을 public/models/basic-pitch/로 복사한다.
// (dev, build, test 전에 자동 실행)
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('@spotify/basic-pitch/package.json'));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'basic-pitch');
mkdirSync(out, { recursive: true });
for (const f of ['model/model.json', 'model/group1-shard1of1.bin', 'LICENSE']) {
  copyFileSync(join(pkg, f), join(out, f.split('/').pop()));
}
console.log('Basic Pitch 모델 복사 →', out);
