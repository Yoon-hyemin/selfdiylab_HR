// chrome-extension/content-lib.js
// content.js가 쓰는 순수 함수 모음. DOM/브라우저 API에 의존하지 않아
// node --test로 그대로 단위테스트할 수 있다.

const BLOCKED_TITLE_MARKERS = ['2단계 인증', '로그인'];

export function isBlockedPage(url, pageTitle) {
  if (typeof url === 'string' && url.includes('certification')) return true;
  if (typeof pageTitle !== 'string') return false;
  return BLOCKED_TITLE_MARKERS.some(marker => pageTitle.includes(marker));
}

export function pickScrollTarget(mainScrollHeight, mainClientHeight, docScrollHeight, viewportHeight) {
  const mainIsScrollable = mainScrollHeight > mainClientHeight + 1;
  if (mainIsScrollable) return 'main';
  const docIsScrollable = docScrollHeight > viewportHeight + 1;
  if (docIsScrollable) return 'document';
  return null; // 이력서가 뷰포트 안에 다 들어와서 스크롤이 필요 없는 경우
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
