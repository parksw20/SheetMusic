import type { PracticeResult } from '../engine/practice';

interface Props {
  result: PracticeResult;
  onRetry: () => void;
  onClose: () => void;
}

const MESSAGES = ['조금 더 연습해 봐요!', '좋아요!', '잘했어요!', '완벽해요!'];

export function ResultPanel({ result, onRetry, onClose }: Props) {
  return (
    <div className="overlay" role="dialog" aria-label="연습 결과">
      <div className="result">
        <div className="stars" aria-label={`별 ${result.stars}개`}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={i <= result.stars ? 'on' : ''}>
              ★
            </span>
          ))}
        </div>
        <h2>{MESSAGES[result.stars]}</h2>
        <dl>
          <dt>정확도</dt>
          <dd>{result.accuracy}%</dd>
          <dt>맞은 음 / 틀린 음</dt>
          <dd>
            {result.correct} / {result.wrong}
          </dd>
          <dt>한 번에 통과</dt>
          <dd>
            {result.cleanSteps} / {result.totalSteps}
          </dd>
          <dt>걸린 시간</dt>
          <dd>{result.seconds}초</dd>
        </dl>
        <div className="actions">
          <button className="primary" onClick={onRetry}>
            다시 하기
          </button>
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
