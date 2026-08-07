/**
 * handlers/my-goals/[id]/submit.js
 *
 * PATCH (본문 없음) -> 200 { ok: true }
 *
 * 2026-08-06(개인목표 화면 재설계): 개인 목표는 만들면 바로 status='draft'로
 * 시작한다(handlers/my-goals/index.js) — 본인이 가중치를 다듬을 시간을 주기
 * 위해서다. 이 엔드포인트가 "승인 요청" 버튼의 서버 쪽 동작이다:
 * draft 또는 rejected 상태의 목표를 pending으로 넘겨서 부서장의 검토
 * 대기열(부서 목표 탭)에 나타나게 한다.
 *
 * 사용자가 정의한 매커니즘: "승인 요청 시에는 가중치 합계가 정확히 100%여야
 * 한다"(임시저장 중엔 100% 미만이어도 됨). 그래서 이 목표만이 아니라 같은
 * 사람·같은 달의 개인 목표 전체 가중치 합을 검사한다 — 가중치가 하나라도
 * null(미설정)이면 정확히 100%를 맞출 수 없으므로 함께 거부한다.
 */
import { sql } from '../../_lib/db.js';
import { requireMemberAuth } from '../../_lib/memberSession.js';
import { isEditableMonth } from '../../_lib/monthWindow.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { id } = req.query;

  try {
    const [okr] = await sql`SELECT id, level, member_id, month, status FROM okrs WHERE id = ${id}`;
    if (!okr) return res.status(404).json({ error: '목표를 찾을 수 없어요' });
    if (okr.level !== '개인') return res.status(400).json({ error: '개인 목표가 아니에요' });
    if (okr.member_id !== memberId) return res.status(403).json({ error: '본인이 만든 목표만 승인 요청할 수 있어요' });
    if (okr.status !== 'draft' && okr.status !== 'rejected') {
      return res.status(400).json({ error: '작성 중이거나 반려된 목표만 승인 요청할 수 있어요' });
    }
    if (!isEditableMonth(okr.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 승인 요청할 수 있어요' });

    const goals = await sql`SELECT weight FROM okrs WHERE level = '개인' AND member_id = ${memberId} AND month = ${okr.month}`;
    if (goals.some(g => g.weight === null)) {
      return res.status(400).json({ error: '이번 달 개인 목표에 가중치가 설정되지 않은 항목이 있어요. 모든 목표에 가중치를 입력해주세요' });
    }
    const sum = goals.reduce((a, g) => a + g.weight, 0);
    if (sum !== 100) {
      return res.status(400).json({ error: `이번 달 개인 목표 가중치 합계가 100%가 아니에요 (현재 ${sum}%)` });
    }

    await sql`UPDATE okrs SET status = 'pending', review_note = '' WHERE id = ${okr.id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit goal' });
  }
}
