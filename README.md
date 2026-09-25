# SheetMusic

심플리피아노(Simply Piano) 같은 **피아노 악보 연습 앱**입니다. 현재는 1단계 MVP로, **iPad**(가로/세로)에서 악보를 크게 보는 것을 기준으로 화면을 구성했습니다.

## 기능 (1단계 MVP)

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

### 마이크 인식 방식과 한계

악보를 받아 적는 대신, **지금 쳐야 할 음이 새로 울렸는지만 확인**합니다 (`src/input/pitch.ts`).

1. 스펙트럼 변화량으로 새 타건을 찾습니다.
2. 타건 직후 기대 음의 주파수 에너지가 타건 전보다 커졌고, 옆 반음보다 큰 봉우리이면 맞음으로 봅니다.
3. 기대 음이 안 들리고 다른 음이 뚜렷하면 그 음을 틀린 음으로 보고합니다.

알려진 한계:
- **옥타브 혼동**: 낮은 음의 2배음이 한 옥타브 위 음과 같은 주파수라서, 화음에 옥타브 관계의 두 음(예: C3+C4)이 있으면 아래 음만 쳐도 위 음이 맞은 것으로 잡힐 수 있습니다.
- **빠른 연타**: 타건 사이 최소 간격이 약 0.17초라서 아주 빠른 연타는 놓칠 수 있습니다. 대기 모드에서는 문제가 되지 않습니다.
- **스피커 소리**: 마이크를 켠 상태에서 `들어보기`를 하면 재생음이 마이크로 들어갑니다. 연습 중일 때만 판정하므로 채점에는 영향이 없습니다.

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
  input/pitch.ts          마이크 스펙트럼에서 기대 음 검증 (순수 로직, 합성음 테스트 있음)
  input/mic.ts            마이크 → AnalyserNode → pitch.ts 연결
  input/                  MIDI, 외장 키보드 입력 → 공통 NoteInput 이벤트
  audio/synth.ts          Tone.js 신스, 악보 재생
  components/             ScoreView(OSMD, 커서와 맞은 음 색칠), ResultPanel
  App.tsx                 화면 구성과 상태 연결
```

마이크, MIDI, 외장 키보드는 모두 같은 `NoteInput` 이벤트로 들어오고, 채점 엔진은 입력 방식을 모릅니다.

기능 분석과 이후 로드맵은 [docs/ROADMAP.md](docs/ROADMAP.md)에 있습니다.
