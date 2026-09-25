# SheetMusic

심플리피아노(Simply Piano) 같은 **피아노 악보 연습 앱**입니다. 현재는 1단계 MVP로, **iPad**(가로/세로)에서 악보를 크게 보는 것을 기준으로 화면을 구성했습니다.

## 기능 (1단계 MVP)

- **악보 표시**: MusicXML 악보를 [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/)로 화면 가득 그리고, 지금 칠 위치를 커서로 표시. `−`/`+`로 악보 크기 조절(기본 140%, 저장됨)
- **대기 모드 연습**: 맞는 음(화음은 모든 음)을 칠 때까지 기다렸다가 다음으로 이동. 연습 중에는 설정 줄을 숨겨 악보 영역을 넓힘
- **피드백**: 맞게 친 음은 악보에서 초록색으로 바뀌고, 틀리면 악보 테두리가 빨갛게 깜빡임. 상단에 다음에 칠 음(계이름, 음이름) 표시
- **채점**: 맞은 음, 틀린 음, 정확도, 한 번에 통과한 비율, 별점(0~3), 곡별 최고 별점 저장
- **입력 방식**
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
npm test         # 단위 테스트 (파서, 채점 엔진)
npm run build    # 타입 검사 + 프로덕션 빌드
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
  score/model.ts          내부 음표 모델 (NoteEvent, Step), 손 필터, 음 이름
  score/parseMusicXml.ts  MusicXML → NoteEvent[] (backup/forward, 화음, 붙임줄, 임시표)
  engine/practice.ts      대기 모드 상태 머신과 채점 (순수 함수, 테스트 있음)
  input/                  MIDI, 컴퓨터 키보드 입력 → 공통 NoteInput 이벤트
  audio/synth.ts          Tone.js 신스, 악보 재생
  components/             ScoreView(OSMD, 커서와 맞은 음 색칠), ResultPanel
  App.tsx                 화면 구성과 상태 연결
```

MIDI와 외장 키보드는 모두 같은 `NoteInput` 이벤트로 들어옵니다. 그래서 나중에 마이크 인식을 붙일 때도 입력 어댑터 하나만 추가하면 됩니다.

기능 분석과 이후 로드맵은 [docs/ROADMAP.md](docs/ROADMAP.md)에 있습니다.
