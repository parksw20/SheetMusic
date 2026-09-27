import { Component, type ReactNode } from 'react';

/**
 * 예상하지 못한 오류로 화면이 통째로 사라지는(하얀 화면) 대신 안내와 다시 열기 버튼을 보여 준다.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('화면 오류', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>문제가 생겼어요</h2>
        <p className="muted">다시 열면 대부분 해결돼요.</p>
        <button className="btn primary" onClick={() => location.replace(location.pathname)}>
          다시 열기
        </button>
        <small>{String(this.state.error.message)}</small>
      </div>
    );
  }
}
