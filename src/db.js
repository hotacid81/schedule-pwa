// SW에서도 같은 이름을 사용한다. 하위 폴더마다 독립 저장소를 갖는다.
export const DB_NAME = `schedule-helper:${new URL('../', import.meta.url).pathname}`;
let opened;
export function openDB() {
  if (!opened) opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['tasks', 'events', 'inbox']) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = null; }; resolve(request.result); };
    request.onerror = () => { opened = null; reject(request.error); };
    request.onblocked = () => { opened = null; reject(new Error('다른 앱 창을 닫고 다시 시도해 주세요.')); };
  });
  return opened;
}
async function transact(store, mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('저장하지 못했습니다.'));
  });
}
export const list = store => transact(store, 'readonly', s => s.getAll());
export const put = (store, record) => transact(store, 'readwrite', s => s.put(record));
export const remove = (store, id) => transact(store, 'readwrite', s => s.delete(id));
export const newID = () => crypto.randomUUID();
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number), date = new Date(y, m - 1, d);
  return y >= 1900 && y <= 9999 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
export function validateRecord(value, store) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 100 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new Error('제목 또는 식별자가 올바르지 않습니다.');
  const record = { id: value.id, title: value.title.trim(), date: value.date || '', time: value.time || '', notes: value.notes ?? '' };
  if ((store === 'events' || record.date) && !validDate(record.date)) throw new Error('날짜를 확인해 주세요.');
  if (record.time && (typeof record.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time))) throw new Error('시간을 확인해 주세요.');
  if (typeof record.notes !== 'string' || record.notes.length > 10000) throw new Error('메모는 10,000자 이내로 입력해 주세요.');
  if (store === 'tasks') { if (typeof value.done !== 'boolean') throw new Error('완료 표시가 올바르지 않습니다.'); record.done = value.done; }
  return record;
}
export function validateBackup(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.tasks) || !Array.isArray(data.events) || data.tasks.length + data.events.length > 10000) throw new Error('지원하는 일정 도우미 백업이 아닙니다.');
  const result = {};
  for (const store of ['tasks', 'events']) {
    result[store] = data[store].map(v => validateRecord(v, store));
    if (new Set(result[store].map(v => v.id)).size !== result[store].length) throw new Error('백업에 중복 식별자가 있습니다.');
  }
  return result;
}
// 기존 항목을 유지하며 병합한다. 같은 ID는 백업 값으로 갱신한다.
export async function importBackup(data) {
  const checked = validateBackup(data), db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tasks', 'events'], 'readwrite');
    for (const store of ['tasks', 'events']) for (const record of checked[store]) tx.objectStore(store).put(record);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('백업을 가져오지 못했습니다.'));
  });
}
