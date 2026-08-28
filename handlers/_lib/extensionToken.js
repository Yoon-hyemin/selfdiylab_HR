// handlers/_lib/extensionToken.js
/**
 * 크롬 확장이 HR 사이트 API를 호출할 때 쓰는 "연결 코드"의 생성·해시
 * 로직. 계정 비밀번호(handlers/_lib/accountAuth.js의 generateTempPassword/
 * hashPassword)와 원칙은 같지만, 이건 사람이 손으로 옮겨 적는 게
 * 아니라 복사-붙여넣기 하는 값이라 가독성보다 엔트로피를 우선해서
 * crypto.randomBytes로 만든다. bcrypt 대신 sha256을 쓰는 이유: API
 * 토큰은 매 요청마다 "이 해시로 계정을 찾아야" 해서(bcrypt.compare처럼
 * 저장된 해시 하나와 1:1 비교가 아니라 DB에서 WHERE token_hash = ? 로
 * 조회) bcrypt의 매 호출 다른 salt 방식이 아니라 결정적(deterministic)
 * 해시가 필요하다.
 */
import crypto from 'node:crypto';

export function generateExtensionToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function hashExtensionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
