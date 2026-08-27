// chrome-extension/offscreen.js
// Tesseract.js worker를 오프스크린 문서 안에서 실행한다. background.js가
// 보내는 OCR_IMAGE 메시지를 받아 이미지(dataURL)를 텍스트로 바꿔 돌려준다.
// Tesseract 전역 객체는 offscreen.html이 vendor/tesseract.min.js를 일반
// <script>로 먼저 로드해서 만들어둔다.

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('kor', 1, {
      workerPath: chrome.runtime.getURL('vendor/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract-core-simd-lstm.wasm.js'),
      langPath: chrome.runtime.getURL('vendor/lang-data'),
      gzip: true
    });
  }
  return workerPromise;
}

export async function recognizeText(dataUrl) {
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrl);
  return data.text;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'OCR_IMAGE') return false;
  recognizeText(message.dataUrl).then(text => sendResponse({ text }));
  return true; // 비동기 응답을 위해 채널을 열어둔다
});

// 수동 테스트 모드: 확장을 로드한 뒤 주소창에
// chrome-extension://<확장ID>/offscreen.html?test=1 을 직접 열면,
// 캔버스에 한글 텍스트를 그려서 OCR 파이프라인 자체를 실제 사이트 없이
// 검증할 수 있다. <확장ID>는 chrome://extensions 카드에 적혀 있다.
if (new URLSearchParams(location.search).get('test') === '1') {
  const canvas = document.getElementById('testCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.font = '32px sans-serif';
  ctx.fillText('안녕하세요 테스트 입니다', 20, 50);
  const testDataUrl = canvas.toDataURL('image/png');
  recognizeText(testDataUrl).then(text => {
    document.getElementById('output').textContent = text;
  });
}
