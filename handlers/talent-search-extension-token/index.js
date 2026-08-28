// handlers/talent-search-extension-token/index.js
/**
 * GET  -> 200 { hasToken: boolean, lastUsedAt: string|null }
 * POST -> 200 { token }  (원문 코드, 이 응답에서만 딱 한 번 노출됨)
 *
 * 계정 하나당 연결 코드 하나. POST(재발급)하면 기존 코드는 즉시
 * 무효화된다(UPSERT로 덮어씀) -- 여러 개를 발급해서 관리하는 복잡함을
 * 피하려고 계정 비밀번호 재설정과 같은 "새로 만들면 예전 건 끝"
 * 방식을 그대로 따른다.
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { generateExtensionToken, hashExtensionToken } from '../_lib/extensionToken.js';

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const [row] = await sql`
        SELECT last_used_at FROM talent_search_extension_tokens WHERE account_id = ${account.id}`;
      return res.status(200).json({ hasToken: !!row, lastUsedAt: row ? row.last_used_at : null });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '연결 코드 상태를 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    try {
      const token = generateExtensionToken();
      const tokenHash = hashExtensionToken(token);
      await sql`
        INSERT INTO talent_search_extension_tokens (account_id, token_hash)
        VALUES (${account.id}, ${tokenHash})
        ON CONFLICT (account_id) DO UPDATE SET token_hash = ${tokenHash}, created_at = now(), last_used_at = NULL`;
      return res.status(200).json({ token });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '연결 코드를 발급하지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
