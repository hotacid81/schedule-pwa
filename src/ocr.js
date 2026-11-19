// 유일한 외부 실행 라이브러리. 진입 화면에서는 다운로드하지 않는다.
const CDN = 'https://cdn.jsdelivr.net/npm/';
const SCRIPT = `${CDN}tesseract.js@5.1.1/dist/tesseract.min.js`;
let loading;
function loadLibrary() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); loading = null; reject(new Error('인식 자료 다운로드 시간이 초과되었습니다. 인터넷 연결 후 다시 시도해 주세요.')); }, 60000);
    script.src = SCRIPT;
    script.onload = () => { clearTimeout(timer); resolve(globalThis.Tesseract); };
    script.onerror = () => { clearTimeout(timer); script.remove(); loading = null; reject(new Error('처음 이미지 인식에는 인터넷이 필요합니다. 연결 후 다시 시도해 주세요.')); };
    document.head.append(script);
  });
  return loading;
}
let busy = false;
export async function recognizeImage(file, onProgress = () => {}) {
  if (busy) throw new Error('이전 이미지 인식이 끝난 뒤 다시 시도해 주세요.');
  if (!file?.type?.startsWith('image/') || file.size > 15 * 1024 * 1024) throw new Error('15MB 이하의 이미지 파일을 선택해 주세요.');
  busy = true;
  let worker;
  try {
    onProgress('인식 자료를 준비하고 있습니다. 첫 사용은 시간이 걸립니다.');
    const Tesseract = await loadLibrary();
    // v5의 기본 언어 URL에는 버전이 없다. 고정 URL의 바이트를 직접 전달한다.
    const languages = await Promise.all(['kor', 'eng'].map(async code => {
      const response = await fetch(`${CDN}@tesseract.js-data/${code}@1.0.0/4.0.0_best_int/${code}.traineddata.gz`, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('인식 언어 자료를 받지 못했습니다.');
      return { code, data: new Uint8Array(await response.arrayBuffer()) };
    }));
    let rejectEngine;
    const engineError = new Promise((_, reject) => { rejectEngine = reject; });
    worker = await Promise.race([Tesseract.createWorker(languages, 1, {
      workerPath: `${CDN}tesseract.js@5.1.1/dist/worker.min.js`,
      corePath: `${CDN}tesseract.js-core@5.1.1`,
      // v5는 기본 오류 처리에서 예외를 다시 던진다. UI 오류 흐름으로 전달한다.
      errorHandler: reason => rejectEngine(new Error(String(reason))),
      logger: m => onProgress(m.status === 'recognizing text' ? `글자를 읽고 있습니다 · ${Math.round(m.progress * 100)}%` : '인식 자료를 준비하고 있습니다…'),
    }), engineError]);
    const { data } = await worker.recognize(file);
    return data.text;
  } catch (error) {
    throw new Error(`이미지를 읽지 못했습니다. 인터넷 연결과 이미지 선명도를 확인하고 다시 시도하거나 글을 붙여넣어 주세요. (${error.message || error})`);
  } finally {
    try { if (worker) await worker.terminate(); } finally { busy = false; }
  }
}
