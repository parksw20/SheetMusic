import type { PracticeResult } from '../engine/practice';
import type { RhythmResult } from '../engine/rhythm';

interface Props {
  result: PracticeResult;
  /** 박자 맞추기 결과면 놓친 음과 정확한 박을 보여 준다 */
  rhythm?: RhythmResult;
  onRetry: () => void;
  onClose: () => void;
}

const MESSAGES = ['조금 더 연습해 봐요!', '좋아요!', '잘했어요!', '완벽해요!'];

export function ResultPanel({ result, rhythm, onRetry, onClose }: Props) {
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
          {rhythm ? (
            <>
              <dt>놓친 음</dt>
              <dd>
                {rhythm.missed} / {rhythm.totalSteps}
              </dd>
              <dt>박자 정확 (±0.11초)</dt>
              <dd>
                {rhythm.good} / {rhythm.totalSteps}
              </dd>
            </>
          ) : (
            <>
              <dt>한 번에 통과</dt>
              <dd>
                {result.cleanSteps} / {result.totalSteps}
              </dd>
            </>
          )}
          <dt>걸린 시간</dt>
          <dd>{result.seconds}초</dd>
        </dl>
        <div className="actions">
          <button className="btn primary" onClick={onRetry}>
            다시 하기
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
