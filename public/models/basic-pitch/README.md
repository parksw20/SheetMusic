# Basic Pitch 모델

Spotify [Basic Pitch](https://github.com/spotify/basic-pitch-ts)의 TensorFlow.js 모델 파일입니다
(`@spotify/basic-pitch` 1.0.1 패키지의 `model/`). Apache License 2.0 (`LICENSE`)을 따릅니다.

- 입력: 22,050Hz 모노 오디오 43,844 샘플 (약 2초), 모양 `[1, 43844, 1]`
- 출력: `Identity_1` 음 활성(frames), `Identity_2` 타건(onsets), 모양 `[1, 172, 88]` (초당 약 86프레임, A0~C8 88건반)
