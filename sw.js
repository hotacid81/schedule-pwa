const ROOT = new URL('./', self.location.href);
const CACHE = `schedule-shell-v2:${ROOT.pathname}`;
const OCR_CACHE = `schedule-ocr-v1:${ROOT.pathname}`;
const FILES = ['./', './index.html', './styles.css', './src/app.js', './src/db.js', './src/parse.js', './src/ocr.js', './src/calendar.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './README.md'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(path => new URL(path, ROOT).href)))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('schedule-shell-') && key.endsWith(`:${ROOT.pathname}`) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
function saveShare(record) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`schedule-helper:${ROOT.pathname}`, 1);
    request.onupgradeneeded = () => { for (const name of ['tasks', 'events', 'inbox']) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('images').filter(f => f instanceof File && f.type.startsWith('image/'));
    if (files.length > 5 || files.some(f => f.size > 15 * 1024 * 1024)) return new Response('이미지는 15MB 이하, 한 번에 5장까지 공유해 주세요.', { status: 413 });
    const text = ['title', 'text', 'url'].map(k => String(form.get(k) || '')).filter(Boolean).join('\n').slice(0, 50000);
    await saveShare({ id: crypto.randomUUID(), text, files, received: Date.now() });
    return Response.redirect(new URL('./?shared=1', ROOT).href, 303);
  } catch {
    return new Response('공유 내용을 저장하지 못했습니다. 앱을 열어 글을 붙여넣어 주세요.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
// OCR에 필요한 버전 고정 jsDelivr 자원만 허용한다. 다른 외부 요청은 가로채지 않는다.
function isOCR(url) {
  return url.origin === 'https://cdn.jsdelivr.net' && /^\/npm\/(?:tesseract\.js@5\.1\.1\/dist\/(?:tesseract|worker)\.min\.js|tesseract\.js-core@5\.1\.1\/[^/]+|@tesseract\.js-data\/(?:kor|eng)@1\.0\.0\/4\.0\.0_best_int\/(?:kor|eng)\.traineddata\.gz)$/.test(url.pathname);
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.href === new URL('./share-target', ROOT).href) { event.respondWith(receiveShare(event.request)); return; }
  if (event.request.method !== 'GET') return;
  if (isOCR(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE), cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') await cache.put(event.request, response.clone());
      return response;
    })());
    return;
  }
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // 문서의 query는 캐시 키에서 제외한다. 원문/개인 데이터를 URL에 넣지 않는다.
  const documentRequest = event.request.mode === 'navigate' || url.pathname === ROOT.pathname || /\.html$/i.test(url.pathname);
  if (documentRequest) url.search = '';
  const key = url.href;
  const networkFirst = documentRequest || /\.(?:js|css|webmanifest)$/i.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (networkFirst) {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          // 저장 공간이 부족해도 이미 받은 최신 응답은 그대로 사용한다.
          try { await cache.put(key, response.clone()); } catch {}
          return response;
        }
        return await cache.match(key) || response;
      } catch (error) {
        const cached = await cache.match(key);
        if (cached) return cached;
        throw error;
      }
    }
    const cached = await cache.match(key);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  })());
});
