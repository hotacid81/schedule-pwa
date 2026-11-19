// 별도 실행: node projects/schedule-pwa/tests/browser-smoke.mjs
// npm 없이 새 임시 프로필의 headless Chromium으로 실제 DOM·IndexedDB·SW를 시험한다.
// Python 정적 서버를 먼저 띄운다. 기존 사용자 브라우저/프로필은 사용하지 않는다.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const browser = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.APP_URL || 'http://localhost:8080/projects/schedule-pwa/';
const profile = await mkdtemp(join(tmpdir(), 'schedule-pwa-test-'));
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error(`Chromium 시작 실패: ${stderr}`)); }, 15000);
  child.on('error', reject);
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); const found = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (found) { clearTimeout(timer); resolve(found[1]); } });
});
const socket = new WebSocket(endpoint);
console.log('Chromium started; connecting to isolated test browser');
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error('격리 브라우저 연결 시간 초과')); }, 10000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', event => { clearTimeout(timer); child.kill(); reject(new Error(event.message)); }, { once: true });
});
console.log('Test browser connected');
let seq = 0, session;
const pending = new Map(), errors = [], requests = [], failures = [], results = [];
socket.addEventListener('message', message => {
  const packet = JSON.parse(message.data);
  if (packet.id) { const p = pending.get(packet.id); if (!p) return; pending.delete(packet.id); clearTimeout(p.timer); packet.error ? p.reject(new Error(JSON.stringify(packet.error))) : p.resolve(packet.result); }
  if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
  if (packet.method === 'Runtime.consoleAPICalled' && packet.params.type === 'error') errors.push(packet.params.args);
  if (packet.method === 'Log.entryAdded' && packet.params.entry.level === 'error') errors.push(packet.params.entry);
  if (packet.method === 'Network.requestWillBeSent') requests.push(packet.params.request.url);
  if (packet.method === 'Network.loadingFailed' && !packet.params.canceled) failures.push(packet.params.errorText);
});
function call(method, params = {}, target = session) {
  if (process.env.DEBUG_CDP) console.log('CDP', method);
  return new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) })); });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression) {
  const start = Date.now();
  while (Date.now() - start < 10000) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`조건 시간 초과: ${expression}`);
}
function pass(name) { results.push(name); console.log(`PASS ${name}`); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, value) { await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`); }
async function submit(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`); }

try {
  const target = await call('Target.createTarget', { url: 'about:blank' }, null);
  session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await call('Runtime.enable'); await call('Log.enable'); await call('Network.enable'); await call('Page.enable');
  await call('Page.setLifecycleEventsEnabled', { enabled: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.confirm = () => true;" });
  await call('Page.navigate', { url: base });
  await wait("document.querySelector('#task-list .empty') && !document.querySelector('#status').textContent");
  await wait('Boolean(navigator.serviceWorker.controller)');
  assert.equal(await evaluate('innerWidth'), 390);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  pass('390×844 하위 폴더 첫 실행·서비스 워커·가로 넘침 없음');

  await click('#add-task'); await fill('#edit-title', '합성 체크리스트'); await fill('#edit-date', '2026-12-30'); await submit('#editor-form');
  await wait("document.querySelector('#task-list').textContent.includes('합성 체크리스트') && !document.querySelector('#editor').open");
  await click('#task-list .check'); await wait("document.querySelector('#task-list .done')");
  pass('할 일 추가·완료');
  await click('#task-list .item-actions button'); await fill('#edit-title', '합성 체크리스트 수정'); await submit('#editor-form');
  await wait("document.querySelector('#task-list').textContent.includes('합성 체크리스트 수정')");
  await call('Page.reload'); await wait("document.querySelector('#task-list').textContent.includes('합성 체크리스트 수정')");
  assert.equal(await evaluate("document.querySelector('#task-list .check').getAttribute('aria-pressed')"), 'true');
  pass('할 일 수정·새로고침 유지');
  await click('#task-list .delete'); await wait("document.querySelector('#task-list .empty')"); pass('할 일 삭제');

  await click('[data-tab="find"]');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#image-input')).display"), 'none');
  assert.equal(await evaluate("document.querySelector('#image-input').labels[0].textContent.includes('캡처 이미지에서 찾기')"), true);
  assert.equal(await evaluate("document.querySelector('label[for=\"image-input\"]').tabIndex"), 0);
  assert.equal(await evaluate("document.querySelector('label[for=\"image-input\"]').getAttribute('role')"), 'button');
  assert.deepEqual(await evaluate(`(() => {
    const input = document.querySelector('#image-input'), label = input.labels[0];
    let clicks = 0; const originalClick = input.click;
    input.click = () => clicks++;
    for (const key of ['Enter', ' ']) label.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    input.click = originalClick;
    return { associated: label.control === input, visible: label.getBoundingClientRect().height >= 44, clicks };
  })()`), { associated: true, visible: true, clicks: 2 });
  await fill('#paste-text', '합성 기획 회의 일정 안내\n일시: 내일 오후 3시\n장소: 본사 회의실'); await submit('#find-form');
  await wait("document.querySelectorAll('.suggestion-card').length === 1");
  assert.equal(await evaluate("document.querySelector('#event-list .item-card') === null"), true);
  assert.equal(await evaluate("document.querySelector('.suggestion-card [name=title]').value"), '합성 기획 회의');
  assert.equal(await evaluate("document.querySelector('.suggestion-card [name=notes]').value"), '장소: 본사 회의실');
  await fill('.suggestion-card [name=notes]', '장소: 본사 회의실 · 합성 수정');
  await fill('.suggestion-card [name=title]', '합성 제안 확인'); await click('.suggestion-card [data-store=events]');
  await wait("document.querySelectorAll('.suggestion-card').length === 0");
  await click('[data-tab="events"]'); await wait("document.querySelector('#event-list').textContent.includes('합성 제안 확인')");
  assert.equal(await evaluate("document.querySelector('#event-list .notes').textContent"), '장소: 본사 회의실 · 합성 수정');
  pass('붙여넣기 → 제안 수정 → 명시적 일정 저장');
  await click('#add-event'); await fill('#edit-title', '합성 직접 일정'); await submit('#editor-form');
  await wait("document.querySelector('#event-list').textContent.includes('합성 직접 일정')");
  await click('#event-list .item-actions button'); await fill('#edit-title', '합성 직접 일정 수정'); await fill('#edit-notes', '<script>합성 텍스트</script>'); await submit('#editor-form');
  await wait("document.querySelector('#event-list').textContent.includes('합성 직접 일정 수정')");
  assert.equal(await evaluate("document.querySelector('#event-list script') === null"), true);
  await call('Page.reload'); await wait("document.querySelector('#event-list').textContent.includes('합성 직접 일정 수정')");
  pass('일정 직접 추가·수정·메모 안전 표시·재시작 유지');

  const backup = await evaluate("(async () => { const db = await import('./src/db.js'); return { version: 1, tasks: await db.list('tasks'), events: await db.list('events') }; })()");
  assert.equal(backup.events.length, 2);
  assert.equal(await evaluate("(async () => { const db = await import('./src/db.js'); try { await db.importBackup({version:1,tasks:[],events:[{id:'bad',title:'합성',date:'2026-02-30'}]}); return false; } catch { return (await db.list('events')).length === 2; } })()"), true);
  assert.equal(await evaluate(`(async () => { const db = await import('./src/db.js'); const data = ${JSON.stringify(backup)}; data.events[0].title = '합성 백업 복원'; await db.importBackup(data); return (await db.list('events')).some(e => e.title === '합성 백업 복원'); })()`), true);
  pass('실제 IndexedDB 백업 병합·불량 백업 원자적 거부');

  // HTTP 서버는 POST를 지원하지 않지만 제어 중인 SW가 요청을 처리해야 한다.
  const shared = await evaluate("(async () => { const f = new FormData(); f.set('title','합성 공유'); f.set('text','모레 오전 10시 합성 공유 회의'); const r = await fetch('./share-target', {method:'POST',body:f}); const db=await import('./src/db.js'); return { ok:r.ok, url:r.url, records:(await db.list('inbox')).length }; })()");
  assert.equal(shared.ok, true); assert.equal(shared.records, 1); assert.ok(shared.url.endsWith('?shared=1'));
  await call('Page.navigate', { url: base + '?shared=1' }); await wait("document.querySelectorAll('.suggestion-card').length === 1 && !document.querySelector('#find-panel').hidden");
  assert.equal(await evaluate("(async()=>{const db=await import('./src/db.js');return (await db.list('events')).length})()"), 2);
  pass('실제 공유 POST → 임시함 → 제안, 자동 일정 저장 없음');
  await click('.suggestion-card .discard'); await wait("document.querySelectorAll('.suggestion-card').length === 0");
  await evaluate("[...document.querySelectorAll('#shared-inbox button')].find(b=>b.textContent==='공유 원문 지우기').click()");
  await wait("document.querySelectorAll('#shared-inbox article').length === 0"); pass('제안 버리기·공유 원문 폐기');

  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"), '#141923');
  await click('[data-tab="events"]');
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(fileURLToPath(new URL('./mobile-dark.png', import.meta.url)), Buffer.from(shot.data, 'base64'));
  pass('다크 모드·390px 화면 캡처');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const light = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(fileURLToPath(new URL('./mobile-light.png', import.meta.url)), Buffer.from(light.data, 'base64'));

  assert.deepEqual(requests.filter(url => !url.startsWith(new URL(base).origin) && !url.startsWith('data:')), []);
  pass('일반 실행·붙여넣기 외부 요청 0');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call('Page.reload'); await wait("document.querySelector('#add-task') && document.querySelector('#connection').textContent.includes('오프라인')");
  await click('#add-task'); await fill('#edit-title', '합성 오프라인 할 일'); await submit('#editor-form');
  await wait("document.querySelector('#task-list').textContent.includes('합성 오프라인 할 일')");
  await click('[data-tab="find"]'); await fill('#paste-text', '내일 15:30 합성 오프라인 회의'); await submit('#find-form');
  await wait("document.querySelectorAll('.suggestion-card').length === 1");
  pass('오프라인 새로고침·할 일 저장·붙여넣기 제안');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []); pass('브라우저 콘솔 오류·네트워크 실패 0');
  await writeFile(fileURLToPath(new URL('./browser-result.json', import.meta.url)), JSON.stringify({ viewport: '390x844', base, results, errors, failures, externalRequests: [], browser: await call('Browser.getVersion', {}, null) }, null, 2));
  console.log(`Browser smoke: ${results.length} passed, ${errors.length} console errors`);
} catch (error) {
  console.error('Browser smoke failed:', error.message, '\nChromium diagnostics:', stderr);
  process.exitCode = 1;
} finally {
  // 응답 없는 렌더러도 시험 프로세스를 붙잡지 않도록 종료한다.
  socket.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }));
  socket.close(); child.kill();
}
