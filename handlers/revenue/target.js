/**
 * handlers/revenue/target.js
 *
 * POST { year, annualTarget, baseCumulativeActual, baseThroughMonth } -> 200 { ok: true }
 *
 * 2026-08-12: 연간 매출 목표/기초 누적 실적을 (필요하면) 고치는 엔드포인트.
 * sql/013_revenue.sql이 2026년 기본값(연 400억, 6월까지 기초 누적 159억)을
 * 이미 없을 때만 심어두므로, 평소엔 이 엔드포인트를 안 써도 되지만, 다음
 * 연도로 넘어갈 때나 기초값이 잘못 들어간 경우를 위해 관리자가 직접 고칠
 * 수 있게 열어둔다. handlers/revenue/index.js와 같은 이유로 관리자 전용.
 */
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const b = req.body || {};
  const { year } = b;
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'year가 올바르지 않아요' });

  const annualTarget = Number(b.annualTarget);
  const baseCumulativeActual = Number(b.baseCumulativeActual);
  const baseThroughMonth = Number.isInteger(b.baseThroughMonth) ? b.baseThroughMonth : 0;
  if (!Number.isFinite(annualTarget) || annualTarget <= 0) return res.status(400).json({ error: '연간 목표가 올바르지 않아요' });
  if (!Number.isFinite(baseCumulativeActual) || baseCumulativeActual < 0) return res.status(400).json({ error: '기초 누적 실적이 올바르지 않아요' });
  if (baseThroughMonth < 0 || baseThroughMonth > 12) return res.status(400).json({ error: '기초 누적 기준월이 올바르지 않아요' });

  try {
    await sql`
      INSERT INTO revenue_targets (year, annual_target, base_cumulative_actual, base_through_month)
      VALUES (${year}, ${annualTarget}, ${baseCumulativeActual}, ${baseThroughMonth})
      ON CONFLICT (year) DO UPDATE SET
        annual_target = EXCLUDED.annual_target,
        base_cumulative_actual = EXCLUDED.base_cumulative_actual,
        base_through_month = EXCLUDED.base_through_month,
        updated_at = now()`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save revenue target' });
  }
}
