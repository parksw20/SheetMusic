/*! 교차 출처 격리(COOP/COEP)를 켜는 서비스 워커.
 * coi-serviceworker (Guido Zuidhof and contributors, MIT, https://github.com/gzuidhof/coi-serviceworker)를
 * 바탕으로, 유튜브 영상을 넣어야 하는 페이지(주소에 ?nocoi)는 격리하지 않도록 고쳤다.
 * 격리하면 WebAssembly 멀티스레드로 음 인식이 빨라지지만, 헤더가 없는 외부 iframe(유튜브)을 막는다. */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const r = event.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    const url = new URL(r.url);
    // 다른 사이트 요청과, 유튜브 모드 페이지 자체는 그대로 둔다
    if (url.origin !== self.location.origin) return;
    if (r.mode === 'navigate' && url.searchParams.has('nocoi')) return;
    event.respondWith(
      fetch(r).then((response) => {
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }),
    );
  });
} else {
  (() => {
    const nocoi = new URLSearchParams(location.search).has('nocoi');
    if (window.crossOriginIsolated !== false || nocoi || !window.isSecureContext || !navigator.serviceWorker) return;
    const reloadOnce = () =>
      navigator.serviceWorker.ready.then(() => {
        try {
          if (sessionStorage.getItem('coi-reloaded')) return;
          sessionStorage.setItem('coi-reloaded', '1');
        } catch {
          return;
        }
        location.reload();
      });
    navigator.serviceWorker.register(document.currentScript.src).then(
      (registration) => {
        // 처음 설치되거나 새 버전으로 바뀌면, 켜진 뒤 한 번만 다시 불러와 헤더를 받는다
        registration.addEventListener('updatefound', reloadOnce);
        if (registration.active && !navigator.serviceWorker.controller) reloadOnce();
      },
      (err) => console.error('COOP/COEP 서비스 워커를 등록하지 못했습니다', err),
    );
  })();
}
