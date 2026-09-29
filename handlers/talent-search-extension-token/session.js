// handlers/talent-search-extension-token/session.js
/**
 * POST -> 200 { token, expiresAt }
 *
 * 2026-09-29 추가. HR 사이트 프로젝트 화면의 [사람인에서 수집 시작]이
 * 누를 때마다 이걸 불러 12시간짜리 임시 통행증(extensionSessionToken.js)을
 * 받고, 크롬 확장(hr-bridge.js)에 같이 넘긴다 -- 컴퓨터마다 연결 코드를
 * 손으로 붙여넣지 않아도 되게 하려는 것. 로그인 쿠키 세션이 있어야만
 * 발급된다(requireTalentSearchAccess). DB에 아무것도 저장하지 않아서,
 * 계정당 하나뿐인 기존 연결 코드(index.js)와 달리 여러 컴퓨터가 서로를
 * 끊지 않는다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { createExtensionSessionToken } from '../_lib/extensionSessionToken.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;
  return res.status(200).json(createExtensionSessionToken(account.id, account.session_version));
}
