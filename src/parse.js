const DAY = '일월화수목금토';
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function validDate(y, m, d) {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const value = new Date(y, m - 1, d);
  return value.getFullYear() === y && value.getMonth() === m - 1 && value.getDate() === d ? value : null;
}

function datesIn(line, today) {
  const found = [], occupied = [];
  function scan(regex, resolve) {
    for (const m of line.matchAll(regex)) {
      const start = m.index, end = start + m[0].length;
      if (occupied.some(([a, b]) => start < b && end > a)) continue;
      occupied.push([start, end]); // 잘못된 전체 날짜를 부분 날짜로 다시 해석하지 않는다.
      const date = resolve(m);
      found.push({ start, end, date });
    }
  }
  const year = today.getFullYear();
  function noYear(month, day) {
    // 연도를 먼저 정해야 올해는 없고 내년에는 있는 2/29도 해석할 수 있다.
    const past = +month < today.getMonth() + 1 || (+month === today.getMonth() + 1 && +day < today.getDate());
    return validDate(year + (past ? 1 : 0), +month, +day);
  }
  scan(/(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g, m => validDate(+m[1], +m[2], +m[3]));
  scan(/(?<!\d)(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, m => validDate(+m[1], +m[2], +m[3]));
  scan(/(?<![\d./-])(\d{1,2})[/.](\d{1,2})(?![\d./])/g, m => noYear(m[1], m[2]));
  scan(/(?<!\d)(\d{1,2})월\s*(\d{1,2})일/g, m => noYear(m[1], m[2]));
  scan(/(?<!\d)(\d{1,2})일/g, m => {
    const day = +m[1], month = today.getMonth() + 1;
    const date = validDate(year, month, day);
    if (day < today.getDate()) return validDate(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, day);
    return date;
  });
  scan(/오늘|내일|모레|글피/g, m => {
    const date = new Date(today);
    date.setDate(date.getDate() + ['오늘', '내일', '모레', '글피'].indexOf(m[0]));
    return date;
  });
  scan(/(이번\s*주|다음\s*주)\s*([월화수목금토일])요일/g, m => {
    const date = new Date(today);
    const monday = (today.getDay() + 6) % 7;
    const target = (DAY.indexOf(m[2]) + 6) % 7;
    date.setDate(date.getDate() - monday + target + (m[1].startsWith('다음') ? 7 : 0));
    return date;
  });
  // 괄호 요일은 독립 후보가 아닌 앞 날짜 검증용이다.
  scan(/(?<![（(]\s*)([월화수목금토일])요일/g, m => {
    const date = new Date(today);
    date.setDate(date.getDate() + (DAY.indexOf(m[1]) - date.getDay() + 7) % 7);
    return date;
  });
  return found.sort((a, b) => a.start - b.start);
}

const TIME = /(?<!\d)(?:(오전|오후|아침|낮|저녁|밤)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(?:(\d{1,2})분|(반)))?)(?!\d)|정오/g;
function timeIn(text) {
  const m = [...text.matchAll(TIME)][0];
  if (!m) return { time: null, confidence: .9, range: null };
  let hour = +m[2], minute = +(m[3] || m[4] || (m[5] ? 30 : 0));
  let confidence = .95, warning;
  if (m[0] === '정오') { hour = 12; minute = 0; }
  else if (m[1]) {
    if (hour < 1 || hour > 12) warning = '시간 표현이 올바르지 않습니다. 직접 확인해 주세요.';
    else hour = hour % 12 + (/오후|낮|저녁|밤/.test(m[1]) ? 12 : 0);
  } else if (!m[3] && hour >= 1 && hour <= 6) {
    hour += 12;
    confidence = .6;
    warning = '오전/오후가 없어 오후로 추정했습니다. 시간을 확인해 주세요.';
  }
  if (hour > 23 || minute > 59) warning = '시간 표현이 올바르지 않습니다. 직접 확인해 주세요.';
  const invalid = /올바르지/.test(warning || '');
  return { time: invalid ? null : `${pad(hour)}:${pad(minute)}`, confidence: invalid ? .4 : confidence, warning, range: [m.index, m.index + m[0].length] };
}

const FIELD = /^(일시|날짜|시간|일정|when|제목|건명|subject|장소|location)\s*[:：]\s*/i;
const DATE_FIELD = /^(?:일시|날짜|시간|일정|when)\s*[:：]\s*/i;
const TITLE_FIELD = /^(?:제목|건명|subject)\s*[:：]\s*/i;
const LOCATION_FIELD = /^(?:장소|location)\s*[:：]\s*/i;
function cleanLine(text) {
  const line = text.trim().replace(/^(?:\[[^\]\r\n]+\]\s*)+/, '');
  // 항목명과 15:30 같은 시각은 발신자 이름으로 지우지 않는다.
  if (FIELD.test(line)) return line;
  return line.replace(/^([\p{L}][\p{L}\p{N} _.-]{0,19})[:：]\s*/u, (prefix, name) => /\d$/.test(name) ? prefix : '');
}
function titleFrom(text) {
  return text.replace(DATE_FIELD, '').replace(TITLE_FIELD, '').replace(TIME, ' ')
    .replace(/[（(][월화수목금토일](?:요일)?[)）]/g, ' ')
    .replace(/(?:까지입니다|입니다|이에요|예요|할게요|잊지\s*마|하자|먹자)\s*[.!?~…]*\s*$/, '')
    .replace(/(?:^|\s)(?:에|은|는|까지|부터|에서)(?=\s|$)/g, ' ')
    .replace(/에서(?=\s|$)/g, '')
    .replace(/(?:\s+일정)?\s+안내\s*$/, '')
    .replace(/^[\s,:;~·.\-]+|[\s,:;~·.\-]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** 기기 현지 날짜를 기준으로 해석한다. 원문을 저장하거나 외부로 전송하지 않는다. */
export function findSuggestions(text, now = new Date()) {
  if (typeof text !== 'string' || !(now instanceof Date) || !Number.isFinite(now.getTime())) return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sources = text.slice(0, 50000).split(/\r?\n/), lines = sources.map(cleanLine), results = [], keys = new Set();
  function neighbors(lineIndex, direction) {
    const found = [];
    for (let i = lineIndex + direction; i >= 0 && i < lines.length; i += direction) {
      if (datesIn(lines[i], today).length) break;
      if (lines[i]) found.push(lines[i]);
    }
    return found;
  }
  lines.forEach((line, lineIndex) => {
    // 장소에 포함된 '3일 회의실' 등은 독립 날짜 후보로 만들지 않는다.
    if (LOCATION_FIELD.test(line)) return;
    const dates = datesIn(line, today);
    if (!dates.length) return;
    const above = neighbors(lineIndex, -1), below = neighbors(lineIndex, 1);
    const explicitTitle = [...above, ...below].find(s => TITLE_FIELD.test(s));
    const heading = above.find(s => !LOCATION_FIELD.test(s) && !DATE_FIELD.test(s) && titleFrom(s));
    const locationLine = [...below, ...above].find(s => LOCATION_FIELD.test(s));
    dates.forEach((item, index) => {
      if (!item.date) return;
      const end = dates[index + 1]?.start ?? line.length;
      // 날짜 앞의 주제 조사만 정리한다. '수은', '김예은' 같은 명사는 보존한다.
      const before = index === 0 ? line.slice(0, item.start).replace(/([가-힣])([은는])\s*$/, (all, last, particle) => {
        const hasFinal = (last.charCodeAt(0) - 0xAC00) % 28 !== 0;
        return (particle === '은') === hasFinal ? last : all;
      }) : '';
      const after = line.slice(item.end, end);
      const content = `${before} ${after}`;
      const time = timeIn(content);
      const warnings = time.warning ? [time.warning] : [];
      const weekday = after.match(/^\s*[（(]([월화수목금토일])(?:요일)?[)）]/);
      if (weekday && DAY.indexOf(weekday[1]) !== item.date.getDay()) warnings.push('날짜와 괄호 안 요일이 다릅니다. 날짜를 확인해 주세요.');
      let title = titleFrom(explicitTitle || (DATE_FIELD.test(line) && heading) || content);
      if (!title) {
        const neighbor = [...above, ...below].find(s => !LOCATION_FIELD.test(s) && !DATE_FIELD.test(s) && titleFrom(s));
        title = titleFrom(neighbor || '') || '새 일정';
      }
      const date = stamp(item.date), key = `${date}/${time.time}`;
      if (keys.has(key)) return;
      keys.add(key);
      const result = { date, time: time.time, title, source: sources[lineIndex], confidence: warnings.length ? Math.min(time.confidence, .6) : time.confidence };
      if (locationLine) result.location = locationLine.replace(LOCATION_FIELD, '').trim();
      if (warnings.length) result.warning = warnings.join(' ');
      results.push(result);
    });
  });
  return results;
}
