declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export interface VersionInfo {
  version: string;
  /** git 커밋 앞 7자리 */
  commit: string;
  /** 빌드 시각 (ISO) */
  builtAt: string;
}

/** 지금 실행 중인 앱의 버전 (빌드할 때 박아 넣음) */
export const CURRENT: VersionInfo = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: __APP_BUILT_AT__,
};

/** 화면 표시용: "v0.5.0 · a1b2c3d · 9/27 15:30" (빌드 시각은 기기 시간대) */
export function versionLabel(v: VersionInfo): string {
  const d = new Date(v.builtAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = Number.isNaN(d.getTime())
    ? ''
    : ` · ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `v${v.version} · ${v.commit}${when}`;
}

/** 서버에 배포된 최신 버전. 캐시를 피해서 읽는다. 읽을 수 없으면 null */
export async function fetchDeployed(): Promise<VersionInfo | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VersionInfo;
  } catch {
    return null;
  }
}

/** 새 버전으로 다시 불러온다. 주소에 버전을 붙여 브라우저/CDN 캐시를 피한다 */
export function reloadTo(v: VersionInfo): void {
  location.replace(`${location.pathname}?v=${encodeURIComponent(v.commit)}`);
}
