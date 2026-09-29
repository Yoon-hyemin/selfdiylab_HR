// chrome-extension/hr-bridge.js
//
// HR 사이트(selfdiylab-hr.vercel.app)에 주입된다. 2026-09-29 추가 -- 프로젝트
// 화면의 [사람인에서 수집 시작] 버튼이 팝업을 거치지 않고 확장에 "이
// 프로젝트로 수집 시작"을 전할 수 있게 하는 다리 역할만 한다.
//   - 페이지가 확장 설치 여부를 알 수 있게 <html data-ts-extension="1">을 붙인다.
//   - 페이지가 window.postMessage({source:'hr-page', type:'TS_START_SARAMIN', ...})를
//     보내면 background.js에 START_FROM_HR로 넘기고, 결과를
//     {source:'ts-extension', type:'TS_START_RESULT'}로 돌려준다.
// 같은 창·같은 오리진에서 온 메시지만 받는다(다른 사이트가 iframe 등으로
// 수집을 대신 시작시키지 못하게). 수집 자체의 인증은 여전히 확장에
// 저장된 연결 코드로 한다.

document.documentElement.dataset.tsExtension = '1';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== 'hr-page' || data.type !== 'TS_START_SARAMIN') return;
  const reply = result => window.postMessage({ source: 'ts-extension', type: 'TS_START_RESULT', requestId: data.requestId, ...result }, location.origin);
  chrome.runtime.sendMessage({
    type: 'START_FROM_HR',
    projectId: String(data.projectId || ''),
    projectTitle: String(data.projectTitle || ''),
    target: Math.max(1, Number(data.target) || 30)
  }).then(result => reply(result || { ok: false, error: '확장에서 응답이 없어요' }))
    .catch(err => reply({ ok: false, error: `확장 오류: ${err.message} (확장을 새로고침한 뒤 이 페이지도 새로고침해주세요)` }));
});
