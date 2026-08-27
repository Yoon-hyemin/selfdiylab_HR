/**
 * handlers/talent-search-projects/[id]/candidates/[candidateId].js
 *
 * PATCH { manualStatus: 'insufficient_info' | 'duplicate' | null } -> 200 { id, manualStatus } | 400 | 404
 *
 * Phase 1E-2: 후보 상세 모달에서 "정보 부족"/"중복"으로 수동 표시하거나
 * 해제한다. 사람의 판단 자체가 원본 데이터라서 이 값만 저장한다(점수·
 * 자동판정은 여전히 저장 안 하고 화면에서 계산).
 */
import { sql } from '../../../_lib/db.js';
import { requireTalentSearchAccess } from '../../../_lib/accountAuth.js';

const ALLOWED = ['insufficient_info', 'duplicate'];

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id, candidateId } = req.query;
  const { manualStatus } = req.body || {};
  if (manualStatus !== null && manualStatus !== undefined && !ALLOWED.includes(manualStatus)) {
    return res.status(400).json({ error: '수동 상태 값이 올바르지 않아요' });
  }
  const value = manualStatus || null;

  try {
    const [row] = await sql`
      UPDATE talent_search_candidates SET manual_status = ${value}
      WHERE id = ${candidateId} AND project_id = ${id}
      RETURNING id, manual_status`;
    if (!row) return res.status(404).json({ error: '후보를 찾을 수 없어요' });
    return res.status(200).json({ id: row.id, manualStatus: row.manual_status });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '수동 상태를 저장하지 못했어요' });
  }
}
