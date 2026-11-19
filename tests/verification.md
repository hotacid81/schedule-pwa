# T1·T2 검증 기록 — 2026-11-19

**현재 판정:** 구현 파일 작성 및 Node 시험 통과. 브라우저 실행 기준은 환경 제한으로 미확인. T3 Claude 교차 검토와 T4 화면 시험은 완료되지 않았다.

## 실행 결과

저장소 루트에서 Node v24.11.1:

```text
node --test projects/schedule-pwa/tests
tests 70
suites 0
pass 70
fail 0
cancelled 0
skipped 0
todo 0
```

- 파서 합성 사례 55개, ICS/백업 검증 9개, 서비스 워커 6개. 실제 개인정보는 없다.
- 전체 출력: [unit-output.txt](./unit-output.txt).
- SW 시험은 VM과 가짜 저장소로 요청 처리 경계를 검증한다. 실제 브라우저의 IndexedDB·설치·OS 공유 동작을 대체하지 않는다.
- 모든 앱 JS와 SW의 `node --check` 통과.
- Pillow로 PNG 192×192 / 512×512 확인.
- `python -m http.server 8080 --bind 127.0.0.1`로 실행한 하위 폴더 주소의 `index.html`, `styles.css`, `src/{app,db,parse,ocr,calendar}.js`, `sw.js`, `manifest.webmanifest`, `icons/icon-{192,512}.png`, `README.md`가 모두 HTTP 200을 반환했다.
- manifest `id/start_url/scope`는 `./`, 공유 action은 `./share-target`이다.

## 미확인 항목

390×844에서 CRUD·제안·새로고침 유지·콘솔 오류·오프라인 재실행을 검증하려 했으나, MCP 승인 정책과 브라우저 GPU 종료로 화면 시험을 시작하지 못했다. [두 실패 로그와 연결 도구 결과](./browser-failures.md)를 참조한다. 따라서 **콘솔 오류 없음 또는 화면 동작 통과를 주장하지 않는다.**

- [browser-smoke.mjs](./browser-smoke.mjs): npm 없는 격리 브라우저 회귀 시험. 실행 성공 시 화면 PNG와 JSON 결과를 생성한다. 아직 성공 실행하지 못했다.
- Tesseract 5.1.1의 API와 worker 원문을 확인해 초기 진입 지연 로딩, 코어/언어 고정 URL, 오류 처리 경로를 구현했다. 실제 CDN 다운로드·한국어 OCR 정확도·재방문 오프라인 OCR은 미확인이다.
- 실제 S26의 설치 배너·Android 공유 선택기·파일 공유·ICS 가져오기 미확인.

## Claude 검토 순서

1. 정적 서버 → 390×844 Playwright에서 할 일 CRUD와 완료·붙여넣기 제안 수정/추가·일정 CRUD·새로고침 유지·콘솔 확인.
2. 공유 POST → 임시함 → 제안 확인, 공유 원문 폐기, 일정 자동 저장 없음 확인.
3. JSON UI 내보내기·가져오기와 오류 표시, 오프라인 새로고침, 하위 폴더 경로 확인.
4. 합성 이미지로 OCR 최초 다운로드를 확인하고 외부 요청이 버전 고정 jsDelivr뿐인지 확인. 첫 성공 뒤 오프라인 재실행 확인.
5. 제목/일정 추출의 잘못된 후보를 점검하고, 실제 기기 설치·공유 동작을 별도로 확인.

## 생성 파일 목록

- 앱: `index.html`, `styles.css`, `src/app.js`, `src/db.js`, `src/parse.js`, `src/ocr.js`, `src/calendar.js`.
- PWA: `manifest.webmanifest`, `sw.js`, `icons/source.svg`, `icons/icon-192.png`, `icons/icon-512.png`.
- 안내/환경: `README.md`, `package.json`(ES 모듈 지정만).
- 시험: `tests/index.js`, `tests/parse.test.mjs`, `tests/calendar.test.mjs`, `tests/sw.test.mjs`, `tests/browser-smoke.mjs`, `tests/unit-output.txt`, `tests/browser-failures.md`, 이 기록.
- 프로젝트 계획: `docs/plans/schedule-pwa-implementation.md`. 기존 `schedule-pwa-flow.md`에 현재 상태를 추가했다.
