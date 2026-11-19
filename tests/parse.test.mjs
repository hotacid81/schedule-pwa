import test from 'node:test';
import assert from 'node:assert/strict';
import { findSuggestions } from '../src/parse.js';

const now = new Date(2026, 10, 19, 9, 0); // 목요일, 기기 현지 시각
const cases = [
  ['연 점 표기', '2026.11.23 오후 3시 합성 회의', '2026-11-23', '15:00'],
  ['연 하이픈', '2026-11-23 15:30 합성 회의', '2026-11-23', '15:30'],
  ['연 슬래시', '2026/11/23 합성 모임', '2026-11-23', null],
  ['월 슬래시', '11/23 합성 모임', '2026-11-23', null],
  ['월 점', '11.23 합성 모임', '2026-11-23', null],
  ['한국어', '11월 23일 합성 모임', '2026-11-23', null],
  ['한국어 연도', '2027년 1월 2일 합성 모임', '2027-01-02', null],
  ['일만 미래', '23일 합성 모임', '2026-11-23', null],
  ['일만 과거', '5일 합성 모임', '2026-12-05', null],
  ['오늘', '오늘 합성 회의', '2026-11-19', null],
  ['내일', '내일 오전 10시 30분 합성 회의', '2026-11-20', '10:30'],
  ['모레', '모레 합성 회의', '2026-11-21', null],
  ['글피', '글피 합성 회의', '2026-11-22', null],
  ['이번주', '이번 주 월요일 합성 회의', '2026-11-16', null],
  ['다음주', '다음 주 월요일 합성 회의', '2026-11-23', null],
  ['주 공백 없음', '다음주 금요일 합성 회의', '2026-11-27', null],
  ['요일 미래', '금요일 합성 회의', '2026-11-20', null],
  ['요일 오늘', '목요일 합성 회의', '2026-11-19', null],
  ['요일 넘김', '월요일 합성 회의', '2026-11-23', null],
  ['반', '내일 3시 반 합성 회의', '2026-11-20', '15:30'],
  ['저녁', '내일 저녁 7시 합성 회의', '2026-11-20', '19:00'],
  ['밤', '내일 밤 9시 합성 회의', '2026-11-20', '21:00'],
  ['정오', '내일 정오 합성 회의', '2026-11-20', '12:00'],
  ['자정', '내일 오전 12시 합성 회의', '2026-11-20', '00:00'],
  ['오후12시', '내일 오후 12시 합성 회의', '2026-11-20', '12:00'],
  ['시각 앞쪽', '오후 3시 내일 합성 회의', '2026-11-20', '15:00'],
  ['연도 넘김', '1월 2일 합성 회의', '2027-01-02', null],
  ['과거 명시 연도', '2025-01-02 합성 회의', '2025-01-02', null],
  ['오늘 명시 날짜', '11월 19일 합성 회의', '2026-11-19', null],
];
for (const [name, input, date, time] of cases) {
  test(name, () => {
    const result = findSuggestions(input, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].date, date);
    assert.equal(result[0].time, time);
    assert.match(result[0].title, /합성/);
    assert.equal(result[0].source, input);
  });
}
for (const input of ['', '합성 안내입니다', '오후 3시 합성 회의', '2026-02-30 합성 회의', '13월 23일 합성 회의', '11/31 합성 회의', '0일 합성 회의', '123일 합성 회의']) {
  test(`후보 없음: ${input}`, () => assert.deepEqual(findSuggestions(input, now), []));
}
test('월말 넘김', () => assert.equal(findSuggestions('내일 합성 회의', new Date(2026, 0, 31))[0].date, '2026-02-01'));
test('연말 넘김', () => assert.equal(findSuggestions('모레 합성 회의', new Date(2026, 11, 31))[0].date, '2027-01-02'));
test('일만 연말 넘김', () => assert.equal(findSuggestions('2일 합성 회의', new Date(2026, 11, 31))[0].date, '2027-01-02'));
test('윤년', () => assert.equal(findSuggestions('2028-02-29 합성 회의', now)[0].date, '2028-02-29'));
test('평년 2월29일 거부', () => assert.deepEqual(findSuggestions('2027-02-29 합성 회의', now), []));
test('연도 생략 다음 해가 윤년', () => assert.equal(findSuggestions('2월 29일 합성 회의', new Date(2027, 10, 19))[0]?.date, '2028-02-29'));
test('요일 불일치 경고', () => assert.match(findSuggestions('11월 23일(화) 합성 회의', now)[0].warning, /요일/));
test('요일 일치', () => assert.equal(findSuggestions('11월 23일(월) 합성 회의', now)[0].warning, undefined));
test('오후 추정 신뢰도', () => assert.ok(findSuggestions('내일 3시 합성 회의', now)[0].confidence < findSuggestions('내일 오후 3시 합성 회의', now)[0].confidence));
test('잘못된 시간은 경고', () => { const r = findSuggestions('내일 25:99 합성 회의', now)[0]; assert.equal(r.time, null); assert.match(r.warning, /시간/); });
test('중복 제거', () => assert.equal(findSuggestions('내일 15:00 합성 회의\n내일 15:00 합성 회의', now).length, 1));
test('여러 줄 후보', () => assert.equal(findSuggestions('내일 15:00 합성 회의\n모레 10:00 합성 검토', now).length, 2));
test('한 줄 여러 날짜와 시간 연결', () => assert.deepEqual(findSuggestions('11/23 15:00 합성 회의, 11/24 10:00 합성 검토', now).map(r => r.time), ['15:00', '10:00']));
test('인접 줄 제목', () => assert.equal(findSuggestions('합성 기획 회의\n내일 오후 3시', now)[0].title, '합성 기획 회의'));
test('제목 40자', () => assert.ok(findSuggestions(`내일 ${'가'.repeat(60)}`, now)[0].title.length <= 40));
test('시간만 있는 줄을 날짜로 오인하지 않음', () => assert.deepEqual(findSuggestions('15:30 3시 반', now), []));
test('잘못된 타입', () => assert.deepEqual(findSuggestions(null, now), []));
test('입력 시각 불변', () => { const n = now.getTime(); findSuggestions('다음 주 월요일', now); assert.equal(now.getTime(), n); });

for (const label of ['일시', '날짜', '시간', '일정', 'When']) {
  test(`${label} 항목은 위 제목과 장소 분리`, () => {
    const [result] = findSuggestions(`회의 일정 안내\n\n${label}: 11월 23일 오후 3시\n장소: 본사 회의실`, now);
    assert.equal(result.title, '회의');
    assert.equal(result.location, '본사 회의실');
    assert.equal(result.time, '15:00');
  });
}
for (const label of ['제목', '건명', 'Subject']) {
  test(`${label} 명시 제목 우선`, () => {
    const [result] = findSuggestions(`${label}: 분기 검토\n일시: 11월 23일 오후 3시\n장소: 본사`, now);
    assert.equal(result.title, '분기 검토'); assert.equal(result.location, '본사');
  });
}
for (const [input, title] of [
  ['[카톡] 민수: 내일 오후 3시 회의입니다', '회의'],
  ['[알림] [카톡] 민수: 보고서 마감은 25일까지입니다', '보고서 마감'],
  ['민수: 내일 강남역에서 저녁 먹자', '강남역 저녁'],
  ['내일 점검이에요', '점검'], ['내일 모임예요', '모임'],
  ['내일 보고서 제출할게요', '보고서 제출'], ['내일 회의 잊지마', '회의'],
  ['내일 회의하자', '회의'], ['내일 저녁 먹자', '저녁'],
]) {
  test(`제목 말투 정리: ${input}`, () => assert.equal(findSuggestions(input, now)[0].title, title));
}
test('장소 줄은 비어 있는 제목의 대체값으로 쓰지 않음', () => {
  const [result] = findSuggestions('일시: 내일 오후 3시\n장소: 본사', now);
  assert.equal(result.title, '새 일정'); assert.equal(result.location, '본사');
});
test('제목과 장소의 앞쪽 메신저 표시 정리', () => {
  const [result] = findSuggestions('[카톡] 민수: 제목: 회의\n[카톡] 민수: 일시: 내일 오후 3시\n[카톡] 민수: 장소: 본사', now);
  assert.equal(result.title, '회의'); assert.equal(result.location, '본사');
  assert.equal(result.source, '[카톡] 민수: 일시: 내일 오후 3시');
});
test('날짜 항목에 남은 예정 문구보다 위 제목을 우선', () => {
  assert.equal(findSuggestions('회의 일정 안내\n일시: 내일 오후 3시 예정\n장소: 본사', now)[0].title, '회의');
});
for (const title of ['수은', '김예은']) {
  test(`핵심 명사 보존: ${title}`, () => assert.equal(findSuggestions(`내일 ${title}`, now)[0].title, title));
}
