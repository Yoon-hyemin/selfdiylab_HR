/**
 * handlers/okr-progress/index.js
 *
 * POST { okrId, year, month, monthlyTargetValue?, monthlyActualValue?, status?, note? }
 *   -> 200 { ok: true }
 *
 * 2026-08-07(기간형 기업 목표): 기업 목표 본체(okrs)와 분리된 월별 진행기록
 * upsert 엔드포인트. 같은 okr_id·year·month 조합은 하나만 존재해야 해서
 * (sql/011의 UNIQUE 제약) INSERT ... ON CONFLICT로 있으면 갱신, 없으면
 * 생성한다.
 *
 * 관리자만 쓸 수 있다 — 회사 목표는 관리자만 만들고 고칠 수 있다는 기존
 * 규칙과 대칭이다. 대상 okr이 실제로 level='회사'인지도 확인한다(부서/개인
 * 목표에는 이 진행기록 개념을 적용하지 않는다 — 이번 작업 범위 밖).
 *
 * 목표(okrs)의 month/quarter는 그대로 시작월 기준으로 남아있고, 이 진행
 * 기록의 year/month가 실제로 어느 달의 실적인지를 나타낸다. 누적 실적은
 * 여기 저장하지 않는다 — 프론트에서 기간 시작월부터 조회 대상 월까지의
 * 월별 기록을 매번 합산해서 계산한다(CLAUDE.md의 "서버는 원본만, 집계는
 * 클라이언트가 계산" 원칙과 동일).
 */
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const b = req.body || {};
  const { okrId, year, month } = b;
  if (!okrId) return res.status(400).json({ error: '목표를 선택해주세요' });
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year/month가 올바르지 않아요' });
  }

  const monthlyTargetValue = b.monthlyTargetValue === '' || b.monthlyTargetValue == null ? null : Number(b.monthlyTargetValue);
  const monthlyActualValue = b.monthlyActualValue === '' || b.monthlyActualValue == null ? null : Number(b.monthlyActualValue);
  if (monthlyTargetValue !== null && !Number.isFinite(monthlyTargetValue)) {
    return res.status(400).json({ error: '월 목표값은 숫자여야 해요' });
  }
  if (monthlyActualValue !== null && !Number.isFinite(monthlyActualValue)) {
    return res.status(400).json({ error: '월 실적값은 숫자여야 해요' });
  }
  const status = (b.status || '').trim() || null;
  const note = (b.note || '').trim() || null;

  try {
    const [okr] = await sql`SELECT id, level FROM okrs WHERE id = ${okrId}`;
    if (!okr) return res.status(404).json({ error: '목표를 찾을 수 없어요' });
    if (okr.level !== '회사') return res.status(400).json({ error: '기업 목표에만 월별 진행기록을 남길 수 있어요' });

    await sql`
      INSERT INTO okr_monthly_progress (okr_id, year, month, monthly_target_value, monthly_actual_value, status, note)
      VALUES (${okrId}, ${year}, ${month}, ${monthlyTargetValue}, ${monthlyActualValue}, ${status}, ${note})
      ON CONFLICT (okr_id, year, month) DO UPDATE SET
        monthly_target_value = EXCLUDED.monthly_target_value,
        monthly_actual_value = EXCLUDED.monthly_actual_value,
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        updated_at = now()`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
}
