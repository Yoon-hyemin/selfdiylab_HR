import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SESSION_SECRET = 'test-secret';
const { createExtensionSessionToken, readExtensionSessionToken, isExtensionSessionToken, EXTENSION_SESSION_MAX_AGE_MS } = await import('./extensionSessionToken.js');

const ACC = '3f1c2b9e-1111-2222-3333-444455556666';

test('createExtensionSessionToken: 발급한 통행증은 그대로 읽힌다', () => {
  const { token, expiresAt } = createExtensionSessionToken(ACC, 3, 1000);
  assert.ok(isExtensionSessionToken(token));
  assert.equal(expiresAt, 1000 + EXTENSION_SESSION_MAX_AGE_MS);
  assert.deepEqual(readExtensionSessionToken(token, 2000), { accountId: ACC, sessionVersion: 3 });
});

test('readExtensionSessionToken: 만료되면 null', () => {
  const { token, expiresAt } = createExtensionSessionToken(ACC, 1, 0);
  assert.equal(readExtensionSessionToken(token, expiresAt + 1), null);
});

test('readExtensionSessionToken: 내용을 바꾸면 서명이 안 맞아 null', () => {
  const { token } = createExtensionSessionToken(ACC, 1, 0);
  const forged = token.replace(`.${1}.`, '.2.');
  assert.equal(readExtensionSessionToken(forged, 10), null);
});

test('readExtensionSessionToken: 다른 비밀키로 만든 건 null', async () => {
  const { token } = createExtensionSessionToken(ACC, 1, 0);
  process.env.SESSION_SECRET = 'other';
  try { assert.equal(readExtensionSessionToken(token, 10), null); }
  finally { process.env.SESSION_SECRET = 'test-secret'; }
});

test('readExtensionSessionToken: 로그인 쿠키 모양(4조각)이나 연결 코드(hex)는 통행증이 아니다', () => {
  assert.equal(readExtensionSessionToken(`${ACC}.1.99999999999999.abcd`, 0), null);
  assert.equal(isExtensionSessionToken('a1b2c3d4e5f6'), false);
});
