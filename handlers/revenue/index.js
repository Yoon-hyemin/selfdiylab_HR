/**
 * handlers/revenue/index.js
 *
 * POST { year, month, monthlyTarget?, monthlyActual?, note? } -> 200 { ok: true }
 *
 * 2026-08-12: "매출 달성" 탭의 월별 입력 upsert 엔드포인트. KPI(okrs)와는
 * 완전히 분리된 테이블(revenue_monthly)이라 KPI 실행률 계산에 전혀 영향을
 * 주지 않는다. 관리자 전용(sales:write 같은 별도 권한을 새로 만들지 않고
 * 기존 ADMIN 권한을 그대로 씀 -- handlers/okr-progress/index.js와 같은 이유).
 *
 * 2026-08-12(2차): "입력중/확정" 상태와 "월별 목표 합계 불일치 시 저장
 * 차단"을 제거했다 -- 자동저장되는 단순 관리표로 바꿔달라는 요청 때문에,
 * 저장 자체를 막는 검증은 이제 없다(입력하면 그대로 저장). revenue_monthly.
 * status 컬럼은 지우지 않았지만(기존 데이터 보존) 이 엔드포인트가 더 이상
 * 건드리지 않는다 -- UPDATE의 SET 목록에서 뺐다(기존 값이 있으면 그대로
 * 남고, 새로 생기는 행은 컬럼 기본값 '입력중'이 들어가지만 화면 어디에도
 * 노출되지 않는 죽은 값이다).
 */
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const b = req.body || {};
  const { year, month } = b;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year/month가 올바르지 않아요' });
  }

  const monthlyTarget = b.monthlyTarget === '' || b.monthlyTarget == null ? null : Number(b.monthlyTarget);
  const monthlyActual = b.monthlyActual === '' || b.monthlyActual == null ? null : Number(b.monthlyActual);
  if (monthlyTarget !== null && !Number.isFinite(monthlyTarget)) return res.status(400).json({ error: '월 목표는 숫자여야 해요' });
  if (monthlyActual !== null && !Number.isFinite(monthlyActual)) return res.status(400).json({ error: '월 실적은 숫자여야 해요' });
  const note = (b.note || '').trim() || null;

  try {
    const [target] = await sql`SELECT 1 FROM revenue_targets WHERE year = ${year}`;
    if (!target) return res.status(400).json({ error: `${year}년 연간 매출 목표가 아직 설정되지 않았어요` });

    await sql`
      INSERT INTO revenue_monthly (year, month, monthly_target, monthly_actual, note)
      VALUES (${year}, ${month}, ${monthlyTarget}, ${monthlyActual}, ${note})
      ON CONFLICT (year, month) DO UPDATE SET
        monthly_target = EXCLUDED.monthly_target,
        monthly_actual = EXCLUDED.monthly_actual,
        note = EXCLUDED.note,
        updated_at = now()`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save revenue progress' });
  }
}
