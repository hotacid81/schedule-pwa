import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const root = 'https://synthetic.invalid/nested/schedule/';
function worker({ failStorage = false, cached = null, networkFailure = false, networkStatus = 200, cacheWriteFailure = false } = {}) {
  const listeners = {}, saved = [], databases = [], installed = [], deleted = [], requests = [], writes = [], opened = [];
  const cache = name => ({
    addAll: async urls => installed.push(...urls),
    match: async () => cached === null ? null : new Response(cached),
    put: async (key, response) => {
      if (cacheWriteFailure) throw new Error('synthetic cache quota failure');
      writes.push({ name, key: typeof key === 'string' ? key : key.url, text: await response.text() });
    },
  });
  const indexedDB = { open(name) {
    databases.push(name);
    const req = {};
    queueMicrotask(() => {
      if (failStorage) { req.error = new Error('synthetic storage failure'); req.onerror(); return; }
      req.result = { close() {}, transaction() {
        const tx = { objectStore() { return { put(record) { saved.push(record); queueMicrotask(() => tx.oncomplete()); } }; } };
        return tx;
      } };
      req.onsuccess();
    });
    return req;
  } };
  const context = {
    self: { location: { href: root + 'sw.js' }, addEventListener: (name, fn) => { listeners[name] = fn; }, clients: { claim: async () => {} } },
    URL, Request, Response, File, FormData, crypto: webcrypto, indexedDB,
    caches: { open: async name => { opened.push(name); return cache(name); }, keys: async () => ['unrelated', 'schedule-shell-v0:/nested/schedule/', 'schedule-shell-v1:/nested/schedule/', 'schedule-shell-v1:/other/'], delete: async key => deleted.push(key), match: async () => cached === null ? null : new Response(cached) },
    fetch: async req => { requests.push(typeof req === 'string' ? req : req.url); if (networkFailure) throw new Error('synthetic offline'); return new Response('synthetic resource', { status: networkStatus }); },
  };
  vm.runInNewContext(source, context);
  return { saved, databases, installed, deleted, requests, writes, opened, async lifecycle(name) { let promise; listeners[name]({ waitUntil(p) { promise = p; } }); await promise; }, dispatch(request) { let promise; listeners.fetch({ request, respondWith(p) { promise = p; } }); return promise; } };
}
test('SW 설치 자원은 모두 하위 경로 안, 외부 요청 없음', async () => {
  const sw = worker(); await sw.lifecycle('install');
  assert.ok(sw.installed.length >= 12); assert.ok(sw.installed.every(url => url.startsWith(root))); assert.deepEqual(sw.requests, []);
});
test('SW 갱신은 현재 하위 경로의 이전 앱 캐시만 삭제', async () => {
  const sw = worker(); await sw.lifecycle('activate'); assert.deepEqual(sw.deleted, ['schedule-shell-v0:/nested/schedule/', 'schedule-shell-v1:/nested/schedule/']);
});
test('SW 실제 multipart POST를 공유 임시함에 넣고 303 반환', async () => {
  const sw = worker(), form = new FormData(); form.set('title', '합성 제목'); form.set('text', '내일 합성 회의'); form.set('images', new File(['synthetic'], 'synthetic.png', { type: 'image/png' }));
  const response = await sw.dispatch(new Request(root + 'share-target', { method: 'POST', body: form }));
  assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), root + '?shared=1');
  assert.equal(sw.saved.length, 1); assert.equal(sw.saved[0].text, '합성 제목\n내일 합성 회의'); assert.equal(sw.saved[0].files.length, 1);
  assert.deepEqual(sw.databases, ['schedule-helper:/nested/schedule/']);
});
test('SW 공유 이미지 6장은 저장하지 않고 거절', async () => {
  const sw = worker(), form = new FormData();
  for (let i = 0; i < 6; i++) form.append('images', new File(['synthetic'], `synthetic-${i}.png`, { type: 'image/png' }));
  const response = await sw.dispatch(new Request(root + 'share-target', { method: 'POST', body: form }));
  assert.equal(response.status, 413); assert.equal(sw.saved.length, 0);
});
test('SW 저장 실패는 오류 응답, 성공 리다이렉트 없음', async () => {
  const sw = worker({ failStorage: true }), form = new FormData(); form.set('text', '합성 공유');
  const response = await sw.dispatch(new Request(root + 'share-target', { method: 'POST', body: form }));
  assert.equal(response.status, 500); assert.equal(response.headers.get('Location'), null);
});
test('SW 버전 고정 OCR 요청만 런타임 캐시 대상', async () => {
  const sw = worker();
  const pinned = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int/kor.traineddata.gz';
  assert.equal((await sw.dispatch(new Request(pinned))).status, 200); assert.deepEqual(sw.requests, [pinned]);
  assert.equal(sw.dispatch(new Request('https://cdn.jsdelivr.net/npm/tesseract.js/dist/tesseract.min.js')), undefined);
  assert.equal(sw.dispatch(new Request('https://synthetic-external.invalid/')), undefined);
});
for (const path of ['index.html', 'src/app.js', 'styles.css', 'manifest.webmanifest']) {
  test(`SW ${path} 네트워크 우선과 v2 캐시 갱신`, async () => {
    const sw = worker({ cached: 'synthetic old shell' }), url = root + path;
    assert.equal(await (await sw.dispatch(new Request(url))).text(), 'synthetic resource');
    assert.deepEqual(sw.requests, [url]);
    assert.deepEqual(sw.writes, [{ name: 'schedule-shell-v2:/nested/schedule/', key: url, text: 'synthetic resource' }]);
  });
}
test('SW navigate 요청은 확장자 없이도 네트워크 우선, 문서 query 제거', async () => {
  const sw = worker({ cached: 'synthetic old shell' });
  assert.equal(await (await sw.dispatch({ url: root + '?shared=1', mode: 'navigate', method: 'GET' })).text(), 'synthetic resource');
  assert.equal(sw.writes[0].key, root);
});
test('SW 앱 네트워크 실패는 저장된 캐시 반환', async () => {
  const sw = worker({ cached: 'synthetic offline shell', networkFailure: true });
  assert.equal(await (await sw.dispatch(new Request(root + 'src/parse.js'))).text(), 'synthetic offline shell');
  assert.equal(sw.requests.length, 1); assert.deepEqual(sw.writes, []);
});
test('SW HTTP 오류는 캐시 fallback, 오류 응답 캐시 금지', async () => {
  const sw = worker({ cached: 'synthetic good shell', networkStatus: 503 });
  assert.equal(await (await sw.dispatch(new Request(root + 'index.html'))).text(), 'synthetic good shell');
  assert.deepEqual(sw.writes, []);
});
test('SW 캐시 저장 실패도 성공 네트워크 응답 유지', async () => {
  const sw = worker({ cached: 'synthetic old shell', cacheWriteFailure: true });
  assert.equal(await (await sw.dispatch(new Request(root + 'src/app.js'))).text(), 'synthetic resource');
});
for (const url of [root + 'icons/icon-192.png', 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js']) {
  test(`SW 아이콘/OCR 캐시 우선 유지: ${url}`, async () => {
    const sw = worker({ cached: 'synthetic cached resource' });
    assert.equal(await (await sw.dispatch(new Request(url))).text(), 'synthetic cached resource');
    assert.deepEqual(sw.requests, []);
  });
}
