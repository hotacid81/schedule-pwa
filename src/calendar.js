import { validDate } from './db.js';
const compact = value => value.replaceAll('-', '').replaceAll(':', '');
const escapeICS = value => String(value || '').replaceAll('\\', '\\\\').replaceAll('\r', '').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number), next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}
function times(event) {
  if (!validDate(event.date)) throw new Error('내보낼 날짜를 확인해 주세요.');
  if (!event.time) return { start: compact(event.date), end: compact(nextDate(event.date)), allDay: true };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) throw new Error('내보낼 시간을 확인해 주세요.');
  // 기기 시간대 기준, 기본 길이 1시간. 자정 넘김도 날짜에 반영한다.
  const [hour, minute] = event.time.split(':').map(Number);
  return { start: `${compact(event.date)}T${compact(event.time)}00`, end: `${compact(hour === 23 ? nextDate(event.date) : event.date)}T${String((hour + 1) % 24).padStart(2, '0')}${String(minute).padStart(2, '0')}00`, allDay: false };
}
export function googleCalendarURL(event) {
  const t = times(event), url = new URL('https://calendar.google.com/calendar/render');
  url.search = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates: `${t.start}/${t.end}`, details: event.notes || '', ctz: Intl.DateTimeFormat().resolvedOptions().timeZone }).toString();
  return url.href;
}
function fold(line) {
  let result = '', bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
    result += char; bytes += size;
  }
  return result;
}
export function toICS(event, now = new Date()) {
  const t = times(event);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Schedule Helper//KO', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${escapeICS(event.id)}@schedule-helper`, `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART${t.allDay ? ';VALUE=DATE' : ''}:${t.start}`, `DTEND${t.allDay ? ';VALUE=DATE' : ''}:${t.end}`, `SUMMARY:${escapeICS(event.title)}`, `DESCRIPTION:${escapeICS(event.notes)}`, 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
