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
