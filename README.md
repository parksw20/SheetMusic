# SheetMusic

심플리피아노(Simply Piano) 같은 **피아노 악보 연습 앱**입니다. 현재는 1단계 MVP로, **iPad**(가로/세로)에서 악보를 크게 보는 것을 기준으로 화면을 구성했습니다.

## 기능 (1단계 MVP)

- **난이도 선택**: 좌상단에서 입문/초급/중급을 고르면 그 난이도의 곡만 보입니다 (7곡)
- **악보 표시**: MusicXML 악보를 [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/)로 그리고, 지금 칠 위치를 커서로 표시
  - 한 줄 4마디, 곡 전체에서 모든 칸이 같은 너비 (줄 첫 칸의 음자리표 포함, `src/score/grid.ts`)
  - 배율은 iPad 세로 화면 폭에 4칸이 꽉 차는 값으로 자동 결정. 가로 화면에서는 같은 배율로 4칸이 화면 폭을 가득 채움
  - 박자표는 줄마다 칸 위치를 맞추려고 악보에서 빼고 상단 제목 옆에 표시
- **대기 모드 연습**: 맞는 음(화음은 모든 음)을 칠 때까지 기다렸다가 다음으로 이동. 연습 중에는 설정 줄을 숨겨 악보 영역을 넓힘
- **피드백**: 맞게 친 음은 악보에서 초록색으로 바뀌고, 틀리면 악보 테두리가 빨갛게 깜빡임. 상단에 다음에 칠 음(계이름, 음이름) 표시
- **채점**: 맞은 음, 틀린 음, 정확도, 한 번에 통과한 비율, 별점(0~3), 곡별 최고 별점 저장
- **입력 방식**
  - **마이크** (iPad 기본): 피아노 소리를 듣고 판정. `🎤 마이크 켜기`로 켜고, 감도(낮음/보통/높음) 조절
  - MIDI 키보드 (Web MIDI: Chrome, Edge 등. **iPad Safari는 미지원**)
  - 외장 키보드 (`A`~`;` 흰 건반, `W E T Y U O P` 검은 건반, `Z`/`X` 옥타브 이동)
- **연습 도구**: 양손/오른손/왼손 선택, 템포 조절(들어보기), 다음 음 표시
- **들어보기**: 선택한 손의 음을 재생하면서 악보 커서를 함께 움직임
- **iPad 홈 화면에 추가**하면 주소창 없이 전체 화면으로 실행
- **내 악보 열기**: `.musicxml` 또는 `.xml` 파일 업로드 (압축된 `.mxl`은 아직 지원하지 않음)

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run dev:ipad # iPad용 HTTPS 개발 서버 (같은 Wi-Fi에서 https://<PC IP>:5173 접속)
npm test         # 단위 테스트 (파서, 채점 엔진)
npm run build    # 타입 검사 + 프로덕션 빌드
```

## 배포 (GitHub Pages)

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 테스트와 빌드를 거쳐 GitHub Pages에 올립니다.
처음 한 번은 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿔야 합니다.

배포 주소: https://parksw20.github.io/SheetMusic/

iPad Safari에서 이 주소를 열고 공유 버튼 → **홈 화면에 추가**를 하면 앱처럼 전체 화면으로 쓸 수 있습니다. HTTPS 주소라서 마이크도 바로 동작합니다.

## iPad에서 마이크로 연습하기

1. 배포 주소를 열거나, 개발 중이라면 PC에서 `npm run dev:ipad`를 실행하고, 표시되는 `Network` 주소(`https://192.168.x.x:5173`)를 iPad Safari로 엽니다.
2. (`dev:ipad`만 해당) 자체 서명 인증서라서 경고가 나옵니다. **세부사항 보기 → 이 웹 사이트 방문**을 누릅니다. 마이크는 HTTPS에서만 동작합니다.
3. `연습 시작`을 누르고 `🎤 마이크 켜기`를 누른 뒤 마이크 권한을 허용합니다.
4. iPad를 피아노 보면대에 두고 연주합니다. 레벨 막대가 움직이는지 확인하세요.

잘 안 잡히면 감도를 `높음`으로, 틀린 음이 너무 자주 나오면 `낮음`으로 바꿉니다.

### 마이크 인식 방식 (AI: Spotify 공식 basic-pitch-ts)

Spotify가 공개한 [basic-pitch-ts](https://github.com/spotify/basic-pitch-ts)(npm `@spotify/basic-pitch`, Apache 2.0)를 그대로 씁니다. 여러 음이 동시에 울리는 화음도 건반별로 구분합니다.

| 단계 | 사용하는 코드 |
|---|---|
| 모델 실행 | 공식 `BasicPitch.evaluateModel` (TensorFlow.js) |
| 음 추출 (시작 시간, 길이, 세기) | 공식 `outputToNotesPoly` → `noteFramesToTime` |
| 모델 파일 | 공식 패키지의 `model/` (빌드할 때 `scripts/copy-model.mjs`가 `public/models/`로 복사) |
| 마이크 수집, 22,050Hz 변환 | `src/input/mic.ts`, `src/input/resample.ts` |
| 별도 스레드 실행 | `src/input/aiWorker.ts`, `src/input/aiClient.ts` |
| 악보와 비교해 맞음/틀림 판정 | `src/input/onsets.ts` (앱 고유 로직, 단위 테스트 있음) |

1. 마이크 소리를 끊김 없이 모읍니다 (AudioWorklet).
2. 0.15초마다 최근 1.8초를 공식 `evaluateModel` → `outputToNotesPoly`에 넣어 음 목록을 받습니다 (타건 확률 기준 0.7).
3. 창이 겹쳐 여러 번 나오는 같은 음은 한 번만 쓰고, 창 시작에 걸친 음(앞에서부터 울리던 음)은 버립니다.
4. 지금 쳐야 할 음이면 맞음, 아니면 세기 0.5 이상일 때만 틀림으로 봅니다. 화음이나 배음이 몇 ms 차이로 잡혀도 틀림으로 세지 않고, 앞 단계를 끝낸 타건으로 다음 단계를 미리 맞히지 않습니다.

분석은 **Web Worker**(별도 스레드)에서 돌아서 화면이 굳지 않습니다. 계산 방식은 WebAssembly를 먼저 쓰고(iPad의 WebGL은 16비트 정밀도라 결과가 틀어질 수 있음), 못 쓸 때만 WebGL, CPU 순으로 씁니다. AI는 앱을 열 때 백그라운드에서 미리 불러옵니다.

마이크를 켜면 악보 위에 진단 줄이 나옵니다. 인식이 안 될 때 어디서 막히는지 알 수 있습니다.

```
오디오 정상 · 48kHz · 수집 worklet 48k/초 · 입력 -40dB · AI worker/wasm 380ms · 최근 인식 2음
```

- `오디오`가 `정상`이 아니면 iPad가 오디오를 멈춘 상태입니다(마이크를 껐다 켜기).
- `수집 … 0k/초`면 소리가 안 들어옵니다. 1초 안에 안 들어오면 다른 수집 방식(`script`)으로 자동 전환합니다.
- `입력`이 -60dB 근처에서 안 움직이면 마이크 권한이나 입력 장치 문제입니다.
- `AI 준비 중`이 오래가면 모델을 받는 중이거나 실패한 것입니다.

사용 순서: `🎤 마이크 켜기` → 버튼이 `🎤 AI 인식 중`으로 바뀌면(모델 준비와 소리 수집, 몇 초 걸림) 연주를 시작합니다. 마이크 옆에는 들린 음이 표시되어 인식이 되는지 바로 볼 수 있습니다.

AI 모델을 불러오지 못하면 예전의 스펙트럼 방식(`src/input/pitch.ts`)으로 판정하고 버튼에 `(기본)`이 붙습니다.

실제 그랜드 피아노 녹음(Salamander Grand Piano)에 방 울림, 마이크 대역, 잡음을 섞어 브라우저에서 앱 전체를 실행한 결과:

| 녹음 | 맞음 | 틀림 |
|---|---|---|
| 작은 별 전곡 (양손 화음) | 65/65 | 0 |
| 징글벨 전곡 | 68/68 | 0 |
| 미뉴에트 G장조 전곡 (8분음표 0.35초 간격) | 83/83 | 0 |
| 도레미 (보통 / 작게 / 시끄러운 방) | 13/13 | 0 |
| 도레미 중간에 틀린 음 2번 | 13/13 | 2 (정확히 잡음) |

지연(건반을 누른 뒤 판정까지)은 약 0.5초입니다. 대기 모드에는 충분하지만, 템포에 맞춰 흘러가는 박자 모드를 만들면 이만큼 보정이 필요합니다.

알려진 한계:
- **스피커 소리**: 마이크를 켠 상태에서 `들어보기`를 하면 재생음이 마이크로 들어갑니다. 연습 중일 때만 판정하므로 채점에는 영향이 없습니다.
- **준비 시간**: 마이크를 켜고 몇 초 뒤부터 판정합니다. 그 전에 친 음은 세지 않습니다.

개발용 재생 테스트(평소에는 건너뜀):

```bash
# 실제 녹음 WAV를 AI 판정으로 재생 (단계는 MIDI 번호 배열)
AI_REPLAY_WAV=연주.wav AI_REPLAY_STEPS='[[60],[62],[64]]' npx vitest run src/input/aiReplay.test.ts
```

## 곡 추가하기

`scripts/generate-songs.mjs`에 간단한 표기법으로 곡을 적은 뒤 `npm run songs`를 실행하면, `public/songs/`에 MusicXML과 곡 목록(`index.json`)이 만들어집니다.

```js
{ rh: 'E4:q. D4:e D4:h', lh: 'C3+E3+G3:w' }  // 음:길이, 화음은 +, 쉼표는 r, 점음표는 '.'
```

MuseScore 같은 악보 프로그램에서 MusicXML로 내보낸 파일을 `public/songs/`에 넣고 `index.json`에 등록해도 됩니다. 저작권이 만료된 곡만 사용하세요.

## 구조

```
src/
  score/grid.ts           한 줄 4칸, 같은 칸 너비를 위한 배율/마디 너비 계산 (테스트 있음)
  score/model.ts          내부 음표 모델 (NoteEvent, Step), 손 필터, 음 이름
  score/parseMusicXml.ts  MusicXML → NoteEvent[] (backup/forward, 화음, 붙임줄, 임시표)
  engine/practice.ts      대기 모드 상태 머신과 채점 (순수 함수, 테스트 있음)
  input/mic.ts            마이크 수집(AudioWorklet), AI/기본 방식 판정 연결
  input/basicPitch.ts     공식 basic-pitch-ts로 인식기 만들기 (WebAssembly 우선)
  input/aiWorker.ts       인식기를 Web Worker에서 실행
  input/aiClient.ts       Worker 불러오기/요청 (미리 불러오기, 실패 시 메인 스레드)
  input/onsets.ts         인식된 음 중복 제거, 맞음/틀림 판정 (순수 로직, 테스트 있음)
  input/resample.ts       마이크 샘플레이트 → 22,050Hz
  input/pitch.ts          기본 방식: 스펙트럼으로 기대 음 검증 (AI를 못 쓸 때)
  input/                  MIDI, 외장 키보드 입력 → 공통 NoteInput 이벤트
  audio/synth.ts          Tone.js 신스, 악보 재생
  components/             ScoreView(OSMD, 커서와 맞은 음 색칠), ResultPanel
  App.tsx                 화면 구성과 상태 연결
```

마이크, MIDI, 외장 키보드는 모두 같은 `NoteInput` 이벤트로 들어오고, 채점 엔진은 입력 방식을 모릅니다.

기능 분석과 이후 로드맵은 [docs/ROADMAP.md](docs/ROADMAP.md)에 있습니다.
