/**
 * handlers/talent-search-projects/[id]/list-candidates/[candidateId].js
 *
 * PATCH { internalReviewStatus?: 'proceed' | 'reject' | null, internalReviewNote?: string }
 *   -> 200 { id, internalReviewStatus, internalReviewNote } | 400 | 404
 *
 * 실제 후보 리스트(talent_search_list_candidates)는 자동판정(직무60점
 * 근사치)만 갖고 있고 사람이 뒤집을 방법이 없었다 -- 자동으로 "추천"이
 * 나온 사람을 실제로는 탈락시키거나, "확인 필요"인 사람을 실제로는
 * 면접까지 보는 경우가 실사용에서 나와서(2026-09-03 요청) 자동판정과
 * 별개인 HR 내부검토 상태 + 메모를 추가했다. 두 필드 다 부분 업데이트를
 * 허용한다(하나만 바뀌어도 다른 값을 다시 안 보내도 되게) -- 값이
 * undefined면 그 필드는 그대로 두고, null/문자열이면 그 값으로 덮어쓴다.
 */
import { sql } from '../../../_lib/db.js';
import { requireTalentSearchAccess } from '../../../_lib/accountAuth.js';

const ALLOWED_STATUS = ['proceed', 'reject'];

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id, candidateId } = req.query;
  const body = req.body || {};
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'internalReviewStatus');
  const hasNote = Object.prototype.hasOwnProperty.call(body, 'internalReviewNote');
  if (!hasStatus && !hasNote) {
    return res.status(400).json({ error: '변경할 값이 없어요' });
  }
  if (hasStatus && body.internalReviewStatus !== null && !ALLOWED_STATUS.includes(body.internalReviewStatus)) {
    return res.status(400).json({ error: '내부검토 상태 값이 올바르지 않아요' });
  }
  if (hasNote && typeof body.internalReviewNote !== 'string' && body.internalReviewNote !== null) {
    return res.status(400).json({ error: '메모는 문자열이어야 해요' });
  }

  try {
    const existing = await sql`
      SELECT internal_review_status, internal_review_note FROM talent_search_list_candidates
      WHERE id = ${candidateId} AND project_id = ${id}`;
    if (!existing.length) return res.status(404).json({ error: '후보를 찾을 수 없어요' });

    const nextStatus = hasStatus ? body.internalReviewStatus : existing[0].internal_review_status;
    const nextNote = hasNote ? body.internalReviewNote : existing[0].internal_review_note;

    const [row] = await sql`
      UPDATE talent_search_list_candidates
      SET internal_review_status = ${nextStatus}, internal_review_note = ${nextNote}
      WHERE id = ${candidateId} AND project_id = ${id}
      RETURNING id, internal_review_status, internal_review_note`;
    return res.status(200).json({
      id: row.id,
      internalReviewStatus: row.internal_review_status,
      internalReviewNote: row.internal_review_note
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '내부검토 내용을 저장하지 못했어요' });
  }
}
