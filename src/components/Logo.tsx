/** 앱 로고: 건반 모양 표시 + 글자 */
export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 40 40" aria-hidden width="34" height="34">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6d63ff" />
            <stop offset="1" stopColor="#3d34b8" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill="url(#logo-g)" />
        <g fill="#fff">
          <rect x="8" y="9" width="7" height="22" rx="2" />
          <rect x="16.5" y="9" width="7" height="22" rx="2" />
          <rect x="25" y="9" width="7" height="22" rx="2" />
        </g>
        <g fill="#2a2380">
          <rect x="13" y="9" width="5" height="13" rx="1.5" />
          <rect x="22" y="9" width="5" height="13" rx="1.5" />
        </g>
      </svg>
      <span className="logo-text">
        Sheet<b>Music</b>
      </span>
    </span>
  );
}
