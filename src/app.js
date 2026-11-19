import { findSuggestions } from './parse.js';
import { list, put, remove, newID, validateRecord, importBackup } from './db.js';
import { recognizeImage } from './ocr.js';
import { googleCalendarURL, toICS, download } from './calendar.js';

const $ = id => document.getElementById(id);
const state = { tasks: [], events: [], suggestions: [], filter: 'upcoming', editing: null, tab: 'tasks' };
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) : '';
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); if ($('settings').open) { $('settings-status').textContent = text; $('settings-status').classList.toggle('error', error); } }
function guarded(fn) { return async (...args) => { try { await fn(...args); } catch (error) { message(error.message || '작업을 처리하지 못했습니다. 다시 시도해 주세요.', true); } }; }
function button(text, cls, action) { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', guarded(action)); return node; }
function switchTab(tab) {
  state.tab = tab;
  for (const name of ['tasks', 'events', 'find']) $(name + '-panel').hidden = name !== tab;
  for (const b of document.querySelectorAll('[data-tab]')) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
}
async function refresh() { [state.tasks, state.events] = await Promise.all([list('tasks'), list('events')]); renderTasks(); renderEvents(); }
function empty(container, symbol, title, copy) { const box = el('div', 'empty'); box.append(el('span', 'empty-symbol', symbol), el('strong', '', title), el('p', '', copy)); container.append(box); }
function recordCard(record, store) {
  const card = el('article', `item-card${record.done ? ' done' : ''}`), row = el('div', 'item-main'), body = el('div', 'item-body');
  if (store === 'tasks') {
    const check = button(record.done ? '✓' : '', 'check', async () => { await put(store, { ...record, done: !record.done }); await refresh(); message(record.done ? '할 일을 다시 열었습니다.' : '한 걸음 완료했어요.'); });
    check.setAttribute('aria-label', `${record.title} ${record.done ? '완료 취소' : '완료 표시'}`); check.setAttribute('aria-pressed', String(record.done)); row.append(check);
  } else {
    const badge = el('div', 'event-date', `${Number(record.date.slice(5, 7))}월`); badge.append(el('strong', '', String(Number(record.date.slice(8))))); row.append(badge);
  }
  body.append(el('h3', 'item-title', record.title));
  if (record.date) body.append(el('p', 'meta', `${store === 'tasks' ? '마감 · ' : ''}${dateLabel(record.date)}${record.time ? ` · ${record.time}` : ' · 시간 미정'}`));
  if (record.notes) body.append(el('p', 'notes', record.notes));
  row.append(body); card.append(row);
  const actions = el('div', 'item-actions');
  actions.append(button('수정', '', () => openEditor(store, record)));
  if (store === 'events') {
    const link = el('a', '', '구글 캘린더 ↗'); link.href = googleCalendarURL(record); link.target = '_blank'; link.rel = 'noopener noreferrer';
    actions.append(link, button('.ics 저장', '', () => { download(toICS(record), '일정.ics', 'text/calendar;charset=utf-8'); message('캘린더 파일을 내보냈습니다. 시간은 현재 기기 시간대 기준입니다.'); }));
  }
  actions.append(button('삭제', 'delete', async () => { if (!confirm(`‘${record.title}’${store === 'tasks' ? ' 할 일을' : ' 일정을'} 삭제할까요?`)) return; await remove(store, record.id); await refresh(); message('삭제했습니다.'); }));
  card.append(actions); return card;
}
function renderTasks() {
  const container = $('task-list'); container.replaceChildren();
  $('task-count').textContent = state.tasks.filter(t => !t.done).length;
  const tasks = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title, 'ko'));
  if (!tasks.length) empty(container, '☑', '작은 일부터 적어 볼까요?', '할 일을 추가하고, 마친 일에 체크해 보세요.');
  tasks.forEach(r => container.append(recordCard(r, 'tasks')));
}
function renderEvents() {
  const container = $('event-list'), today = localDate(); container.replaceChildren();
  const events = state.events.filter(r => state.filter === 'today' ? r.date === today : state.filter === 'past' ? r.date < today : r.date >= today).sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
  if (!events.length) empty(container, '▦', '아직 등록한 약속이 없어요', '일정을 직접 담거나, 찾기에서 글을 붙여넣어 보세요.');
  let group;
  for (const record of events) { if (record.date !== group) { group = record.date; container.append(el('p', 'event-group', dateLabel(group))); } container.append(recordCard(record, 'events')); }
}
function openEditor(store, record) {
  state.editing = { store, record };
  $('editor-heading').textContent = `${store === 'tasks' ? '할 일' : '일정'} ${record ? '수정' : '추가'}`;
  $('edit-title').value = record?.title || ''; $('edit-date').value = record?.date || (store === 'events' ? localDate() : '');
  $('edit-time').value = record?.time || ''; $('edit-notes').value = record?.notes || '';
  $('edit-date').required = store === 'events'; $('date-optional').textContent = store === 'events' ? '필수' : '선택';
  $('editor-error').textContent = ''; $('editor').showModal(); $('edit-title').focus();
}
$('editor-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter || $('editor-form').querySelector('[type=submit]'); submit.disabled = true;
  try {
    const { store, record } = state.editing;
    const value = validateRecord({ id: record?.id || newID(), title: $('edit-title').value, date: $('edit-date').value, time: $('edit-time').value, notes: $('edit-notes').value, done: record?.done || false }, store);
    await put(store, value); await refresh(); $('editor').close(); message('저장했습니다.');
  } catch (error) { $('editor-error').textContent = error.message; } finally { submit.disabled = false; }
});
function updateSuggestions(text) {
  state.suggestions = findSuggestions(text).map(s => ({ ...s, key: newID() })); renderSuggestions();
  $('find-empty').textContent = state.suggestions.length ? '날짜·시간·제목을 확인하고 원하는 곳에 담아 주세요.' : '날짜를 찾지 못했어요. ‘내일 오후 3시 합성 회의’처럼 날짜가 있는 문장을 입력해 주세요.';
}
function field(form, label, type, value, name, required = false) {
  const id = `suggestion-${form.dataset.key}-${name}`, wrap = el('div');
  const lbl = el('label', '', label); lbl.htmlFor = id;
  const input = el('input'); input.id = id; input.name = name; input.type = type; input.value = value || ''; input.required = required;
  if (name === 'title') input.maxLength = 200;
  if (type === 'date') { input.min = '1900-01-01'; input.max = '9999-12-31'; }
  wrap.append(lbl, input); return wrap;
}
function renderSuggestions() {
  const container = $('suggestions'); container.replaceChildren(); $('suggestion-count').textContent = state.suggestions.length;
  state.suggestions.forEach(s => {
    const form = el('form', 'suggestion-card'); form.dataset.key = s.key;
    form.append(el('p', 'eyebrow', s.confidence >= .8 ? '찾은 약속 · 확인해 주세요' : '확인이 필요한 약속'));
    if (s.warning) form.append(el('p', 'warning', s.warning));
    form.append(field(form, '제목', 'text', s.title, 'title', true));
    const row = el('div', 'form-row'); row.append(field(form, '날짜', 'date', s.date, 'date', true), field(form, '시간 · 선택', 'time', s.time, 'time')); form.append(row);
    form.append(field(form, '메모 · 선택', 'text', s.location ? `장소: ${s.location}` : '', 'notes'));
    const details = el('details'); details.append(el('summary', 'hint', '원문 확인'), el('p', 'source', s.source)); form.append(details);
    const actions = el('div', 'suggestion-actions'), error = el('p', 'error'); error.setAttribute('role', 'alert');
    for (const [store, label] of [['events', '일정에 추가'], ['tasks', '할 일로 추가']]) {
      const b = el('button', store === 'events' ? 'primary' : 'secondary', label); b.type = 'submit'; b.dataset.store = store; actions.append(b);
    }
    actions.append(button('버리기', 'discard', () => { state.suggestions = state.suggestions.filter(v => v.key !== s.key); renderSuggestions(); }));
    form.append(actions, error);
    form.addEventListener('submit', async event => {
      event.preventDefault(); const b = event.submitter; b.disabled = true;
      try {
        const data = new FormData(form), store = b.dataset.store;
        const value = validateRecord({ id: newID(), title: data.get('title'), date: data.get('date'), time: data.get('time'), notes: data.get('notes'), done: false }, store);
        await put(store, value); state.suggestions = state.suggestions.filter(v => v.key !== s.key); renderSuggestions(); await refresh(); message(`${store === 'events' ? '일정' : '할 일'}에 담았습니다.`);
      } catch (e) { error.textContent = e.message; b.disabled = false; }
    });
    container.append(form);
  });
}
$('find-form').addEventListener('submit', event => { event.preventDefault(); updateSuggestions($('paste-text').value); });
async function readImages(files, initialText = '') {
  const input = $('image-input'); input.disabled = true; $('find-form').setAttribute('aria-busy', 'true');
  try {
    let text = initialText;
    for (const file of files) text += '\n' + await recognizeImage(file, progress => { $('ocr-progress').textContent = progress; });
    $('paste-text').value = text.slice(0, 50000); updateSuggestions(text);
    $('ocr-progress').textContent = '글자를 읽었습니다. 인식한 글과 날짜를 확인해 주세요.';
  } catch (e) { $('ocr-progress').textContent = e.message; throw e; }
  finally { input.disabled = false; input.value = ''; $('find-form').removeAttribute('aria-busy'); }
}
$('image-input').addEventListener('change', guarded(async event => { const file = event.target.files[0]; if (file) await readImages([file]); }));
document.querySelector('label[for="image-input"]').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('image-input').click(); }
});
async function renderInbox() {
  const container = $('shared-inbox'); container.replaceChildren(); const records = await list('inbox');
  for (const record of records.sort((a, b) => a.received - b.received)) {
    const card = el('article', 'surface shared-card');
    card.append(el('h3', '', '공유받은 내용'), el('p', 'hint', `${record.text.slice(0, 150) || '캡처 이미지'}${record.files.length ? ` · 이미지 ${record.files.length}장` : ''}`));
    card.append(button('다시 제안 찾기', 'secondary', async () => { $('paste-text').value = record.text; if (record.files.length) await readImages(record.files, record.text); else updateSuggestions(record.text); }));
    card.append(button('공유 원문 지우기', '', async () => { await remove('inbox', record.id); await renderInbox(); message('공유 원문을 지웠습니다. 추가한 일정은 보관됩니다.'); })); container.append(card);
  }
  return records;
}
let receiving = false;
async function receiveShared() {
  if (receiving) return; receiving = true;
  try {
    const records = await renderInbox();
    if (!records.length) return;
    switchTab('find'); const record = records.at(-1); $('paste-text').value = record.text;
    if (record.files.length) await readImages(record.files, record.text); else updateSuggestions(record.text);
    message('공유 내용을 받았습니다. 확인한 제안만 저장해 주세요. 원문은 아래에서 지울 수 있어요.');
  } finally { receiving = false; }
}
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => switchTab(b.dataset.tab));
for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { state.filter = b.dataset.filter; for (const other of document.querySelectorAll('[data-filter]')) other.setAttribute('aria-pressed', String(other === b)); renderEvents(); });
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => $(b.dataset.close).close());
$('add-task').addEventListener('click', () => openEditor('tasks'));
$('add-event').addEventListener('click', () => openEditor('events'));
$('settings-open').addEventListener('click', () => $('settings').showModal());
$('export-backup').addEventListener('click', guarded(async () => { const [tasks, events] = await Promise.all([list('tasks'), list('events')]); download(JSON.stringify({ version: 1, exported: new Date().toISOString(), tasks, events }, null, 2), `일정도우미-${localDate()}.json`, 'application/json;charset=utf-8'); message('백업 파일을 내보냈습니다.'); }));
$('backup-input').addEventListener('change', guarded(async event => {
  const input = event.target, file = input.files[0]; if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('10MB 이하의 백업 파일을 선택해 주세요.');
    const data = JSON.parse(await file.text());
    if (!confirm('백업 내용을 기존 기록과 합칠까요? 같은 식별자는 백업 값으로 갱신됩니다.')) return;
    await importBackup(data); await refresh(); $('settings').close(); message('백업을 가져왔습니다.');
  } finally { input.value = ''; }
}));
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install-button').hidden = false; });
$('install-button').addEventListener('click', guarded(async () => { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('install-button').hidden = true; }));
window.addEventListener('appinstalled', () => { $('install-button').hidden = true; message('홈 화면에 설치했습니다.'); });
function updateDay() { $('today-label').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }); $('connection').textContent = navigator.onLine ? '내 폰에 저장' : '오프라인 · 내 폰에 저장'; renderEvents(); }
window.addEventListener('online', updateDay); window.addEventListener('offline', updateDay);
document.addEventListener('visibilitychange', guarded(async () => { if (document.visibilityState === 'visible') { updateDay(); await refresh(); if (new URL(location.href).searchParams.has('shared')) await receiveShared(); } }));
async function start() {
  updateDay(); await refresh();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); }
    catch { message('오프라인 준비를 마치지 못했습니다. 인터넷 연결 후 새로고침해 주세요.', true); }
  }
  if (new URL(location.href).searchParams.has('shared')) {
    await receiveShared(); history.replaceState(null, '', './');
  } else await renderInbox();
}
guarded(start)();
