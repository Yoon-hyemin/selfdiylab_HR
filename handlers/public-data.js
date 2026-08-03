/**
 * handlers/public-data.js
 *
 * GET -> { okrs, evals, calibration, oneonones }
 *
 * The company-wide 성과관리 dataset, deliberately UNAUTHENTICATED: every
 * employee can see 목표 / 평가 / 캘리브레이션 / 원온원. The shapes here are
 * identical to the corresponding four keys of handlers/all.js so the frontend
 * can use either source interchangeably.
 *
 * The `members` table is queried for the id -> name lookup only (evals and
 * oneonones expose an `employeeName`); no member record or any other member
 * column is ever included in this response, since /api/all is the gated
 * endpoint for anything member-related.
 */

import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [members, okrs, evals, calibrationCycles, calibrationOverrides, oneonones] = await Promise.all([
      sql`SELECT id, name FROM members`,
      sql`SELECT * FROM okrs`,
      sql`SELECT * FROM evals`,
      sql`SELECT * FROM calibration_cycles`,
      sql`SELECT * FROM calibration_overrides`,
      sql`SELECT * FROM oneonones ORDER BY date`
    ]);

    const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

    const okrs_out = okrs.map(o => ({
      id: o.id, quarter: o.quarter, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, progress: o.progress, unit: o.unit, target: o.target
    }));

    const evals_out = evals.map(e => ({
      id: e.id, quarter: e.quarter, employee: e.employee_id, employeeName: memberNameById[e.employee_id] || '(삭제된 구성원)',
      common: e.common, lead: e.lead, job: e.job, performance: e.performance, custom: e.custom,
      strength: e.strength, improve: e.improve
    }));

    const calibration_out = {};
    for (const c of calibrationCycles) {
      calibration_out[c.quarter] = {
        targets: { S: c.target_s, A: c.target_a, B: c.target_b, C: c.target_c, D: c.target_d },
        overrides: {}
      };
    }
    for (const o of calibrationOverrides) {
      if (calibration_out[o.quarter]) {
        calibration_out[o.quarter].overrides[o.eval_id] = { grade: o.grade, reason: o.reason };
      }
    }

    const oneonones_out = oneonones.map(m => ({
      id: m.id, employee: m.employee_id, employeeName: memberNameById[m.employee_id] || '(삭제된 구성원)',
      date: m.date, note: m.note
    }));

    res.status(200).json({
      okrs: okrs_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load public data' });
  }
}
