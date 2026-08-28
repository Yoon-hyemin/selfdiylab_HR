// handlers/_lib/extensionToken.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateExtensionToken, hashExtensionToken } from './extensionToken.js';

test('generateExtensionToken: 48자 hex 문자열을 만든다', () => {
  const token = generateExtensionToken();
  assert.equal(typeof token, 'string');
  assert.equal(token.length, 48);
  assert.match(token, /^[0-9a-f]{48}$/);
});

test('generateExtensionToken: 호출할 때마다 다른 값을 만든다', () => {
  const a = generateExtensionToken();
  const b = generateExtensionToken();
  assert.notEqual(a, b);
});

test('hashExtensionToken: 같은 입력이면 항상 같은 해시', () => {
  const token = 'abc123';
  assert.equal(hashExtensionToken(token), hashExtensionToken(token));
});

test('hashExtensionToken: 다른 입력이면 다른 해시', () => {
  assert.notEqual(hashExtensionToken('abc123'), hashExtensionToken('abc124'));
});

test('hashExtensionToken: 64자 hex(sha256) 문자열을 돌려준다', () => {
  const hash = hashExtensionToken('abc123');
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});
