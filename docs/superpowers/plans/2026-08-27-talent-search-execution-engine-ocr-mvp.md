# 인재검색 실행엔진 OCR 추출 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람인 후보 상세 이력서 페이지에서 크롬 확장의 "정보 추출" 버튼을 누르면, 이력서 전체를 자동으로 스크롤하며 화면을 캡처하고 무료 로컬 OCR(Tesseract.js)로 텍스트를 복원해 팝업에 보여준다.

**Architecture:** 서버 없는 순수 크롬 확장(Manifest V3) 하나. 콘텐츠 스크립트가 이력서 영역을 스크롤하며 서비스워커에 캡처를 요청하고, 서비스워커는 화면을 캡처해 오프스크린 문서로 넘긴다. 오프스크린 문서가 Tesseract.js(WASM, 전부 로컬 vendor 파일, 외부 API 호출 없음)로 OCR을 돌려 텍스트를 돌려주고, 팝업이 최종 결과를 모아 보여준다.

**Tech Stack:** Chrome Extension Manifest V3, 순수 JS(ES 모듈), Tesseract.js 5.1.1(vendored), `node --test`(순수 함수 단위테스트).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-27-talent-search-execution-engine-ocr-mvp-design.md` — 범위·안전장치는 이 문서 그대로.
- **이번 슬라이스 범위**: 사람인 후보 1명, 상세 이력서 페이지 하나, 버튼 클릭 → 텍스트 추출 → 팝업 표시까지만. 여러 후보 자동 순회, HR 웹사이트 API 연동, 채점엔진 연동, 다른 플랫폼은 범위 밖 — 이번 계획의 어떤 태스크에도 포함하지 않는다.
- **디렉터리**: `chrome-extension/` (저장소 루트, 기존 `handlers/`·`index.html`과 완전히 독립). 이 저장소의 기존 Vercel 배포 파이프라인과 무관하다 — `api/[...path].js` ROUTES 등록 같은 기존 컨벤션은 이번 계획에 해당 없음.
- **읽기 전용**: 어떤 코드도 사람인 페이지의 버튼(제안, 연락하기, 이직 제안 등)을 대신 클릭하지 않는다. 스크롤과 화면 캡처만 한다.
- **로그인/인증 우회 금지**: 인증이 필요한 화면으로 판단되면 캡처를 시작하지 않고 사용자에게 안내만 한다. 자동 재시도나 우회 코드는 작성하지 않는다.
- **외부 서버 없음**: OCR은 전부 사용자 컴퓨터의 브라우저 안에서 돈다. Tesseract.js 라이브러리·언어데이터는 이번 계획에서 미리 다운로드해 `chrome-extension/vendor/`에 커밋해두고, 확장이 실행될 때는 그 로컬 파일만 쓴다(실행 중 외부 CDN 호출 없음).
- Tesseract.js는 버전 **5.1.1**로 고정한다(더 최신 버전은 이번 계획 작성 시점에 확장 환경에서의 동작을 확인하지 않았음).
- 순수 로직 함수(인증화면 감지, 스크롤 지점 계산, 텍스트 이어붙이기)는 `node --test`로 단위테스트한다. 브라우저 API(스크롤·캡처·OCR 실행 자체)가 얽힌 부분은 크롬에 확장을 직접 로드해서 수동 검증한다(이 저장소가 DB/HTTP/UI 통합 부분에 이미 쓰고 있는 원칙과 동일).
- 커밋 메시지, 코드 주석은 한국어로 쓴다(이 저장소 기존 컨벤션).

---

### Task 1: 확장 뼈대 + 팝업 UI (기능 없이 뜨는지만 확인)

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/popup.html`
- Create: `chrome-extension/popup.js`
- Create: `chrome-extension/content.js`

**Interfaces:**
- Produces: `manifest.json`이 `content_scripts`로 `hiring.saramin.co.kr/applicant-view/*`에 `content.js`를 주입하도록 선언(뒤 Task들이 이 파일에 로직을 채운다). `popup.html`이 `id="extractBtn"` 버튼, `id="status"`, `id="result"` 요소를 갖는다(Task 4가 이 id들을 그대로 쓴다).

- [ ] **Step 1: manifest.json 작성**

```json
{
  "manifest_version": 3,
  "name": "인재검색 이력서 추출 (MVP)",
  "version": "0.1.0",
  "description": "사람인 인재풀 후보 상세 이력서 화면을 스크롤하며 캡처하고, 로컬 OCR로 텍스트를 추출합니다.",
  "permissions": ["activeTab", "tabs", "offscreen"],
  "host_permissions": ["https://hiring.saramin.co.kr/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://hiring.saramin.co.kr/applicant-view/*"],
      "js": ["content.js"]
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

- [ ] **Step 2: 빈 background.js, content.js 자리 만들기**

`background.js`는 Task 3에서, `content.js`는 Task 4에서 실제 내용을 채운다. 지금은 manifest가 참조하는 파일이 존재해야 크롬이 확장을 로드하므로 최소 내용만 넣는다.

```js
// chrome-extension/background.js
// Task 3에서 캡처+OCR 릴레이 로직을 추가한다.
```

```js
// chrome-extension/content.js
// Task 4에서 스크롤+캡처 오케스트레이션 로직을 추가한다.
console.log('[인재검색 추출] 콘텐츠 스크립트 로드됨');
```

- [ ] **Step 3: popup.html 작성**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 360px; padding: 12px; font-family: sans-serif; }
    #result { white-space: pre-wrap; max-height: 300px; overflow-y: auto; border: 1px solid #ccc; padding: 8px; margin-top: 8px; font-size: 12px; }
    #status { margin-top: 8px; color: #555; font-size: 12px; }
    button { padding: 8px 12px; }
  </style>
</head>
<body>
  <button id="extractBtn">이 후보 정보 추출</button>
  <div id="status"></div>
  <pre id="result"></pre>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4: popup.js — 지금은 클릭하면 상태만 바뀌는 자리표시자**

```js
// chrome-extension/popup.js
// Task 4에서 실제 추출 로직(background/content와 메시지 주고받기)을 채운다.
const btn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');

btn.addEventListener('click', () => {
  statusEl.textContent = '(아직 연결 안 됨 — 다음 단계에서 구현)';
});
```

- [ ] **Step 5: 크롬에 확장 로드해서 확인**

1. 크롬 주소창에 `chrome://extensions` 입력
2. 우측 상단 "개발자 모드" 켜기
3. "압축해제된 확장 프로그램을 로드합니다" 클릭 → `chrome-extension` 폴더 선택
4. 오류 없이 로드되는지 확인(로드 안 되면 manifest.json 문법 오류일 가능성이 높음 — 카드에 뜨는 오류 메시지 확인)
5. 아무 사이트에서나 확장 아이콘 클릭 → 팝업이 뜨고 "이 후보 정보 추출" 버튼이 보이는지 확인
6. 버튼 클릭 → "(아직 연결 안 됨 — 다음 단계에서 구현)" 문구가 뜨는지 확인

- [ ] **Step 6: 커밋**

```bash
git add chrome-extension/
git commit -m "$(cat <<'EOF'
feat: 인재검색 실행엔진 확장 뼈대 추가 (manifest, 팝업 UI)

기능 없이 로드·표시만 되는 상태. 다음 태스크에서 OCR/캡처/스크롤
로직을 채운다.
EOF
)"
```

---

### Task 2: Tesseract.js 벤더링 + 오프스크린 OCR 파이프라인 (실제 사이트 없이 자체 검증)

가장 위험한 미검증 부분(브라우저 확장 안에서 Tesseract.js가 실제로 OCR을 돌릴 수 있는가)을 실제 사람인 페이지를 건드리기 전에 먼저 검증한다.

**Files:**
- Create: `chrome-extension/vendor/tesseract.min.js` (다운로드한 파일)
- Create: `chrome-extension/vendor/worker.min.js` (다운로드한 파일)
- Create: `chrome-extension/vendor/tesseract-core-simd-lstm.wasm.js` (다운로드한 파일)
- Create: `chrome-extension/vendor/lang-data/kor.traineddata.gz` (다운로드한 파일)
- Create: `chrome-extension/ocr-lib.js`
- Create: `chrome-extension/ocr-lib.test.js`
- Create: `chrome-extension/offscreen.html`
- Create: `chrome-extension/offscreen.js`
- Modify: `chrome-extension/manifest.json` (오프스크린 문서 등록에 필요한 설정은 이미 Task 1에서 `"offscreen"` permission을 넣어뒀으므로 수정 없음 — 확인만)

**Interfaces:**
- Produces: `ocr-lib.js`가 `export function stitchText(segments: string[]): string`를 export. `offscreen.js`가 `export async function recognizeText(dataUrl: string): Promise<string>`를 export하고, `chrome.runtime.onMessage`로 `{type:'OCR_IMAGE', dataUrl}` 메시지를 받으면 `{text}`로 응답한다. Task 3(background.js)이 이 메시지 계약을 그대로 쓴다.

- [ ] **Step 1: Tesseract.js 및 한글 언어데이터 다운로드**

```bash
mkdir -p chrome-extension/vendor/lang-data
curl -L -o chrome-extension/vendor/tesseract.min.js "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
curl -L -o chrome-extension/vendor/worker.min.js "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js"
curl -L -o chrome-extension/vendor/tesseract-core-simd-lstm.wasm.js "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js"
curl -L -o chrome-extension/vendor/lang-data/kor.traineddata.gz "https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int/kor.traineddata.gz"
```

각 파일이 0바이트가 아닌지 확인:

```bash
ls -la chrome-extension/vendor/ chrome-extension/vendor/lang-data/
```

`kor.traineddata.gz`는 약 1.5MB여야 한다(계획 작성 시점에 확인한 크기: 1,572,336 bytes). 크게 다르면 URL이 잘못됐을 수 있으니 다시 받는다.

- [ ] **Step 2: ocr-lib.js 작성 (텍스트 이어붙이기, 순수 함수)**

스크롤 지점마다 캡처하는 화면은 서로 겹치지 않게 설계할 것이므로(Task 4의 `computeScrollSteps` 참고) 중복 제거 로직은 필요 없다 — 구간별 텍스트를 순서대로 이어붙이기만 한다.

```js
// chrome-extension/ocr-lib.js
// OCR 결과 문자열 여러 개를 하나로 합치는 순수 함수. 브라우저 API에
// 의존하지 않아 node --test로 그대로 단위테스트할 수 있다.

export function stitchText(segments) {
  return segments
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(s => s.length > 0)
    .join('\n\n');
}
```

- [ ] **Step 3: ocr-lib.js 테스트 작성**

```js
// chrome-extension/ocr-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stitchText } from './ocr-lib.js';

test('stitchText: 각 구간을 빈 줄로 이어붙인다', () => {
  assert.equal(stitchText(['첫 구간', '둘째 구간']), '첫 구간\n\n둘째 구간');
});

test('stitchText: 빈 구간/공백만 있는 구간은 건너뛴다', () => {
  assert.equal(stitchText(['첫 구간', '   ', '', '둘째 구간']), '첫 구간\n\n둘째 구간');
});

test('stitchText: 구간이 하나도 없으면 빈 문자열', () => {
  assert.equal(stitchText([]), '');
});
```

- [ ] **Step 4: 테스트 실행**

Run: `node --test chrome-extension/ocr-lib.test.js`
Expected: 3개 테스트 모두 PASS

- [ ] **Step 5: offscreen.html 작성**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <canvas id="testCanvas" width="500" height="100" style="display:none"></canvas>
  <pre id="output"></pre>
  <script src="vendor/tesseract.min.js"></script>
  <script type="module" src="offscreen.js"></script>
</body>
</html>
```

- [ ] **Step 6: offscreen.js 작성**

```js
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
```

- [ ] **Step 7: 오프스크린 문서를 background.js에서 열 수 있게 최소 코드 추가**

Task 3에서 정식으로 구현하지만, 지금 수동 테스트를 하려면 오프스크린 문서를 여는 진입점이 있어야 한다. `offscreen.html?test=1`은 일반 페이지이므로 브라우저 탭에서 직접 열면 오프스크린 문서로서가 아니라 그냥 보통 페이지로 열린다 — `chrome.offscreen` API 없이도 동작해야 이 수동 테스트가 가능하다. `offscreen.js`는 이미 `chrome.offscreen` API를 쓰지 않으므로(그건 background.js 쪽 책임) 이 스텝은 별도 코드 없이 그대로 넘어간다.

- [ ] **Step 8: 확장 리로드 후 수동으로 OCR 파이프라인 검증**

1. `chrome://extensions`에서 이 확장의 "새로고침" 버튼 클릭(코드가 바뀌었으므로)
2. 확장 카드에 적힌 확장 ID 복사(예: `abcdefghijklmnop...`)
3. 새 탭에서 `chrome-extension://<확장ID>/offscreen.html?test=1` 접속
4. 잠시 기다린 후(첫 실행은 언어데이터 로딩 때문에 몇 초 걸릴 수 있음) 페이지에 인식된 텍스트가 나타나는지 확인
5. "안녕하세요 테스트 입니다"와 비슷한 텍스트가 나오면 성공 — 완벽히 똑같지 않아도 됨(OCR이니까), 한글이 알아볼 수 있는 수준으로 나오면 충분

- [ ] **Step 9: 커밋**

```bash
git add chrome-extension/
git commit -m "$(cat <<'EOF'
feat: Tesseract.js 벤더링 + 오프스크린 OCR 파이프라인 추가

크롬 확장 안에서 로컬로 OCR을 돌리는 핵심 파이프라인. 실제 사람인
페이지 연동 전에 offscreen.html?test=1 수동 테스트로 OCR 자체가
동작하는지 먼저 검증했다.
EOF
)"
```

---

### Task 3: 캡처 릴레이 (background.js) — 화면 캡처 → 오프스크린 OCR 요청

**Files:**
- Modify: `chrome-extension/background.js`

**Interfaces:**
- Consumes: Task 2의 오프스크린 문서가 처리하는 `{type:'OCR_IMAGE', dataUrl}` → `{text}` 메시지 계약.
- Produces: `chrome.runtime.onMessage`로 `{type:'CAPTURE_AND_OCR'}` 메시지를 받으면 현재 탭 화면을 캡처하고 OCR까지 마친 뒤 `{text}`로 응답한다. Task 4(content.js)가 이 메시지 계약을 그대로 쓴다.

- [ ] **Step 1: background.js 작성**

```js
// chrome-extension/background.js
// MV3 서비스워커. content.js가 스크롤 지점마다 보내는 캡처 요청을 받아
// 현재 탭 화면을 캡처하고, 오프스크린 문서에 OCR을 맡긴 뒤 결과를
// 돌려준다. 무거운 OCR 연산은 서비스워커가 아니라 오프스크린 문서에서
// 처리한다 -- 서비스워커는 idle 상태에서 언제든 종료될 수 있어 장시간
// 연산에 안 맞다.

const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: 'Tesseract.js OCR은 Web Worker로 동작하며, 서비스워커에서는 안정적으로 못 돌려서 오프스크린 문서에서 실행한다.'
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'CAPTURE_AND_OCR') return false;

  (async () => {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    await ensureOffscreenDocument();
    const ocrResult = await chrome.runtime.sendMessage({ type: 'OCR_IMAGE', dataUrl });
    sendResponse({ text: ocrResult.text });
  })();

  return true; // 비동기 응답을 위해 채널을 열어둔다
});
```

- [ ] **Step 2: 확장 리로드 후 콘솔에서 수동 호출로 확인**

1. `chrome://extensions`에서 확장 새로고침
2. 확장 카드에서 "서비스 워커" 링크 클릭 → DevTools 콘솔이 열림
3. 아무 탭이나 하나 띄워두고(예: 사람인 홈), 그 탭이 현재 활성 탭인 상태에서 서비스워커 콘솔에 다음을 입력해 수동 호출:

```js
chrome.tabs.query({active:true, currentWindow:true}).then(([tab]) => {
  chrome.runtime.sendMessage({type:'CAPTURE_AND_OCR'}, undefined, (res) => console.log('결과:', res));
});
```

4. `{text: "..."}` 형태로 응답이 오는지 확인(화면에 있는 아무 텍스트나 대략 인식되면 성공 — 이 단계에선 사람인 이력서가 아니라 아무 페이지로 테스트해도 됨)

- [ ] **Step 3: 커밋**

```bash
git add chrome-extension/background.js
git commit -m "$(cat <<'EOF'
feat: 캡처+OCR 릴레이(background.js) 추가

content.js가 CAPTURE_AND_OCR 메시지를 보내면 현재 탭 화면을 캡처해
오프스크린 OCR로 넘기고 텍스트를 돌려준다.
EOF
)"
```

---

### Task 4: 스크롤 오케스트레이션(content.js) + 팝업 연결 — 전체 흐름 완성

**Files:**
- Create: `chrome-extension/content-lib.js`
- Create: `chrome-extension/content-lib.test.js`
- Modify: `chrome-extension/content.js`
- Modify: `chrome-extension/popup.js`

**Interfaces:**
- Consumes: Task 3의 `{type:'CAPTURE_AND_OCR'}` → `{text}` 메시지 계약, Task 2의 `stitchText(segments: string[]): string`.
- Produces: `content-lib.js`가 `export function isBlockedPage(url: string, pageTitle: string): boolean`와 `export function computeScrollSteps(scrollHeight: number, viewportHeight: number): number[]`를 export. `content.js`가 `chrome.runtime.onMessage`로 `{type:'START_EXTRACTION'}`을 받으면 `{ok:true, text}` 또는 `{ok:false, reason}`으로 응답한다. `popup.js`가 이 응답을 그대로 화면에 표시한다.

- [ ] **Step 1: content-lib.js 작성 (순수 함수)**

```js
// chrome-extension/content-lib.js
// content.js가 쓰는 순수 함수 모음. DOM/브라우저 API에 의존하지 않아
// node --test로 그대로 단위테스트할 수 있다.

const BLOCKED_TITLE_MARKERS = ['2단계 인증', '로그인'];

export function isBlockedPage(url, pageTitle) {
  if (typeof url === 'string' && url.includes('certification')) return true;
  if (typeof pageTitle !== 'string') return false;
  return BLOCKED_TITLE_MARKERS.some(marker => pageTitle.includes(marker));
}

export function computeScrollSteps(scrollHeight, viewportHeight) {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return [0];
  }
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
  if (maxScrollTop === 0) return [0];

  const steps = [];
  for (let pos = 0; pos < maxScrollTop; pos += viewportHeight) {
    steps.push(pos);
  }
  if (steps[steps.length - 1] !== maxScrollTop) {
    steps.push(maxScrollTop);
  }
  return steps;
}
```

- [ ] **Step 2: content-lib.test.js 작성**

```js
// chrome-extension/content-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedPage, computeScrollSteps } from './content-lib.js';

test('isBlockedPage: 인증 경로 URL이면 true', () => {
  assert.equal(
    isBlockedPage('https://www.saramin.co.kr/zf_user/company-viewer/certification?redirect_url=x', '아무 제목'),
    true
  );
});

test('isBlockedPage: 제목에 "2단계 인증"이 있으면 true', () => {
  assert.equal(isBlockedPage('https://hiring.saramin.co.kr/x', '2단계 인증 요청 - 사람인'), true);
});

test('isBlockedPage: 제목에 "로그인"이 있으면 true', () => {
  assert.equal(isBlockedPage('https://www.saramin.co.kr/login', '로그인 - 사람인'), true);
});

test('isBlockedPage: 정상 이력서 화면이면 false', () => {
  assert.equal(
    isBlockedPage('https://hiring.saramin.co.kr/applicant-view/position/resume/123', '인재풀 후보자 관리 - 사람인'),
    false
  );
});

test('computeScrollSteps: 콘텐츠가 화면보다 작으면 [0] 하나만', () => {
  assert.deepEqual(computeScrollSteps(500, 1000), [0]);
});

test('computeScrollSteps: 정확히 나눠떨어지는 경우', () => {
  assert.deepEqual(computeScrollSteps(3000, 1000), [0, 1000, 2000]);
});

test('computeScrollSteps: 나눠떨어지지 않는 경우 마지막 스텝은 끝까지', () => {
  assert.deepEqual(computeScrollSteps(2500, 1000), [0, 1000, 1500]);
});

test('computeScrollSteps: 잘못된 입력이면 [0]으로 안전하게 처리', () => {
  assert.deepEqual(computeScrollSteps(NaN, 1000), [0]);
  assert.deepEqual(computeScrollSteps(3000, 0), [0]);
});
```

- [ ] **Step 3: 테스트 실행**

Run: `node --test chrome-extension/content-lib.test.js`
Expected: 8개 테스트 모두 PASS

- [ ] **Step 4: content.js 작성**

```js
// chrome-extension/content.js
// 사람인 후보 상세 이력서 페이지에 주입된다. 팝업의 "정보 추출" 클릭을
// 받으면(START_EXTRACTION) 로그인/인증 화면인지 먼저 확인하고, 아니면
// 이력서 영역을 스크롤하면서 매 지점을 background.js에 캡처+OCR
// 요청한다. 이 파일은 manifest에 classic 스크립트로 선언돼 있어
// 최상위 import 문을 쓸 수 없다 -- 순수 함수는 동적 import()로 가져온다.

let libPromise = null;
function getLib() {
  if (!libPromise) {
    libPromise = import(chrome.runtime.getURL('content-lib.js'));
  }
  return libPromise;
}

function findResumeContainer() {
  // 오늘 실사용 확인 기준, 이력서 상세 화면의 실제 콘텐츠는 <main> 안에
  // 렌더링된다. 클래스명은 사람인이 임의로 바꿀 수 있는 해시값이라
  // 의존하지 않는다.
  return document.querySelector('main') || document.scrollingElement;
}

async function runExtraction(sendResponse) {
  const { isBlockedPage, computeScrollSteps } = await getLib();

  if (isBlockedPage(location.href, document.title)) {
    sendResponse({ ok: false, reason: '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요' });
    return;
  }

  const container = findResumeContainer();
  if (!container) {
    sendResponse({ ok: false, reason: '이력서 화면을 찾지 못했습니다' });
    return;
  }

  const steps = computeScrollSteps(container.scrollHeight, window.innerHeight);
  const segments = [];

  for (let i = 0; i < steps.length; i++) {
    container.scrollTo({ top: steps[i], behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 400)); // 스크롤 후 렌더링 안정화 대기

    const captureResult = await chrome.runtime.sendMessage({ type: 'CAPTURE_AND_OCR' });
    segments.push(captureResult.text);

    chrome.runtime.sendMessage({ type: 'PROGRESS', current: i + 1, total: steps.length });
  }

  const { stitchText } = await import(chrome.runtime.getURL('ocr-lib.js'));
  sendResponse({ ok: true, text: stitchText(segments) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'START_EXTRACTION') return false;
  runExtraction(sendResponse);
  return true; // 비동기 응답을 위해 채널을 열어둔다
});
```

- [ ] **Step 5: popup.js를 실제 추출 로직으로 교체**

```js
// chrome-extension/popup.js
const btn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

function onProgress(message) {
  if (message.type === 'PROGRESS') {
    statusEl.textContent = `${message.current}/${message.total} 구간 처리 중...`;
  }
}

btn.addEventListener('click', async () => {
  resultEl.textContent = '';
  statusEl.textContent = '시작 중...';
  btn.disabled = true;
  chrome.runtime.onMessage.addListener(onProgress);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_EXTRACTION' });
    if (!response || !response.ok) {
      statusEl.textContent = (response && response.reason) || '알 수 없는 오류가 발생했어요';
      return;
    }
    statusEl.textContent = '완료';
    resultEl.textContent = response.text;
  } catch (err) {
    statusEl.textContent = `오류: ${err.message} (이 페이지에 확장이 연결되지 않았을 수 있어요 - 사람인 이력서 상세 페이지에서 시도해주세요)`;
  } finally {
    chrome.runtime.onMessage.removeListener(onProgress);
    btn.disabled = false;
  }
});
```

- [ ] **Step 6: 확장 리로드**

`chrome://extensions`에서 이 확장의 새로고침 버튼을 누른다. (content.js가 바뀌었으므로, 이미 열려 있던 사람인 탭은 새로고침해야 새 content.js가 적용된다.)

- [ ] **Step 7: 로그인/인증 화면에서 안전장치 확인**

1. 사람인에 로그인된 상태에서, 세션이 살아있어 바로 통과되지 않을 만한 인증 경로로 이동하기 어렵다면, 대신 `document.title`을 임시로 바꿔서 확인하는 대안: 브라우저 개발자도구 콘솔에서 `document.title = '2단계 인증 요청 - 사람인'` 실행 후 팝업에서 "정보 추출" 클릭
2. "로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요"가 뜨는지, 그리고 캡처가 전혀 시작되지 않는지(진행 상태 문구가 안 뜨는지) 확인
3. 확인 후 `document.title`은 원래대로 돌아오도록 페이지를 새로고침해둔다(임시 변경이라 새로고침하면 사라짐)

- [ ] **Step 8: 실제 후보 이력서로 전체 흐름 검증**

1. 사람인 인재풀에서 실제 후보 상세 이력서 페이지를 연다(짧은 이력서 1명, 긴 이력서 1명 — 총 2명)
2. 확장 아이콘 클릭 → "이 후보 정보 추출" 클릭
3. "N/M 구간 처리 중..." 진행 표시가 순서대로 올라가는지 확인
4. 완료되면 결과 텍스트가 뜨는지, 실제 화면에 보이는 이름 마스킹·나이·경력·학력·연봉 등과 대조했을 때 알아볼 수 있는 수준인지 확인(완벽히 정확하지 않아도 됨 — OCR이므로)
5. 긴 이력서(스크롤 여러 번)에서도 끝까지 끊기지 않고 완료되는지 확인

- [ ] **Step 9: 커밋**

```bash
git add chrome-extension/content.js chrome-extension/content-lib.js chrome-extension/content-lib.test.js chrome-extension/popup.js
git commit -m "$(cat <<'EOF'
feat: 스크롤 오케스트레이션 + 팝업 연결로 전체 추출 흐름 완성

content.js가 이력서 영역을 자동 스크롤하며 background.js에 캡처+OCR을
요청하고, 결과를 이어붙여 팝업에 표시한다. 로그인/인증 화면 감지 시
캡처를 시작하지 않고 안내만 띄운다. 실제 사람인 후보 이력서 2명으로
전체 흐름을 확인했다.
EOF
)"
```

---

## Self-Review 메모 (계획 작성자가 직접 확인함)

- **스펙 커버리지**: 설계 문서의 "구조"(콘텐츠 스크립트/오프스크린/팝업) → Task 1·2·3·4가 각각 담당. "동작 흐름" 5단계 → Task 4의 `runExtraction`이 그대로 구현. "안전장치"(인증 감지·읽기전용·실패안전) → Task 4의 `isBlockedPage`/`findResumeContainer` null 체크로 구현, 읽기전용은 애초에 클릭 코드를 어디에도 안 넣는 것으로 지킴. "테스트" 절의 항목들 → Task 4 Step 7·8이 그대로 수행.
- **플레이스홀더 스캔**: "TODO"/"나중에" 문구 없음. 모든 코드 스텝에 실제 동작하는 코드가 들어있음.
- **타입/시그니처 일관성 확인**: `isBlockedPage(url, pageTitle)`·`computeScrollSteps(scrollHeight, viewportHeight)`·`stitchText(segments)`·`recognizeText(dataUrl)` — 정의한 Task와 사용하는 Task에서 이름·인자 순서가 동일한지 재확인함(일치).
- **범위 확인**: HR 웹사이트 연동·채점엔진 연동·여러 후보 순회·다른 플랫폼 — 어떤 Task에도 포함되지 않음(설계 문서의 "제외" 목록과 일치).
