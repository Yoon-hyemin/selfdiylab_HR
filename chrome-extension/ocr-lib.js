// chrome-extension/ocr-lib.js
// OCR 결과 문자열 여러 개를 하나로 합치는 순수 함수. 브라우저 API에
// 의존하지 않아 node --test로 그대로 단위테스트할 수 있다.

export function stitchText(segments) {
  return segments
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(s => s.length > 0)
    .join('\n\n');
}
