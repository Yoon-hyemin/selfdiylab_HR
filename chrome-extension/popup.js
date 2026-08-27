// chrome-extension/popup.js
// Task 4에서 실제 추출 로직(background/content와 메시지 주고받기)을 채운다.
const btn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');

btn.addEventListener('click', () => {
  statusEl.textContent = '(아직 연결 안 됨 — 다음 단계에서 구현)';
});
