/**
 * handlers/revenue/index.js
 *
 * POST { year, month, monthlyTarget?, monthlyActual?, status?, note? } -> 200 { ok: true }
 *
 * 2026-08-12: "매출 달성" 탭의 월별 입력 upsert 엔드포인트. KPI(okrs)와는
 * 완전히 분리된 테이블(revenue_monthly)이라 KPI 실행률 계산에 전혀 영향을
 * 주지 않는다. handlers/okr-progress/index.js와 같은 패턴(같은 year·month는
 * ON CONFLICT로 upsert, 관리자만 쓸 수 있음) -- 매출 관리 전용 권한
 * (sales:write 같은 것)을 새로 만들지 않고 관리자로 통일했다. 이 프로젝트는
 * accounts.system_role 하나로만 권한을 판정하고(회사 목표·월별 진행기록도
 * 전부 ADMIN 전용), 지금 있는 관리자 1~2명이 곧 매출 입력 담당자와 같은
 * 사람이라 별도 권한 컬럼을 추가하는 게 오히려 불필요한 복잡도를 늘린다고
 * 판단했다(운영 중 실제로 매출 입력을 다른 사람에게 넘겨야 하면 그때
 * system_role 자체를 ADMIN으로 주는 기존 절차를 그대로 쓸 수 있다).
 *
 * status를 '확정'으로 바꾸는 요청은 그 연도의 7월~12월(기초 누적 이후 달)
 * monthly_target 합계가 잔여 목표(연간목표 - 기초 누적)와 정확히 일치할
 * 때만 허용한다("월별 목표 합계 불일치 -> 확정 금지" 요구사항). '입력중'
 * 상태로의 저장/수정은 이 제약 없이 항상 허용한다(자유롭게 임시저장 가능).
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
  const status = (b.status || '입력중').trim();
  if (status !== '입력중' && status !== '확정') return res.status(400).json({ error: '상태는 입력중/확정만 가능해요' });
  const note = (b.note || '').trim() || null;

  try {
    const [target] = await sql`SELECT annual_target, base_cumulative_actual, base_through_month FROM revenue_targets WHERE year = ${year}`;
    if (!target) return res.status(400).json({ error: `${year}년 연간 매출 목표가 아직 설정되지 않았어요` });

    if (status === '확정') {
      const existing = await sql`SELECT month, monthly_target FROM revenue_monthly WHERE year = ${year} AND month != ${month}`;
      const otherSum = existing.reduce((a, r) => a + (r.monthly_target != null ? Number(r.monthly_target) : 0), 0);
      const thisTarget = monthlyTarget != null ? monthlyTarget : 0;
      const sum = otherSum + thisTarget;
      const remaining = Number(target.annual_target) - Number(target.base_cumulative_actual);
      if (Math.round(sum) !== Math.round(remaining)) {
        return res.status(400).json({ error: '월별 목표 합계 불일치', detail: { sum, remaining } });
      }
    }

    await sql`
      INSERT INTO revenue_monthly (year, month, monthly_target, monthly_actual, status, note)
      VALUES (${year}, ${month}, ${monthlyTarget}, ${monthlyActual}, ${status}, ${note})
      ON CONFLICT (year, month) DO UPDATE SET
        monthly_target = EXCLUDED.monthly_target,
        monthly_actual = EXCLUDED.monthly_actual,
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        updated_at = now()`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save revenue progress' });
  }
}
