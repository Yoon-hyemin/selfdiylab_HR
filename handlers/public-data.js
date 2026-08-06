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
 * 2026-08-04: `members`에 team/position을 추가로 노출한다 — 목표 탭의
 * "부서 목표" 화면이 같은 팀 팀원의 이름·직책·개인 목표 진행률을 로그인
 * 없이도 보여줘야 하기 때문이다(역할 구분은 "화면을 다르게 보여주기" 위한
 * 것이지 데이터를 숨기기 위한 게 아니라는 게 이번 재설계의 전제 —
 * docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md
 * 참고). team/position은 급여·주소 같은 민감 정보가 아니라서 추가해도
 * 기존 "민감 정보는 /api/all에만" 원칙에 어긋나지 않는다. role/email/phone
 * 등 나머지 컬럼은 여전히 노출하지 않는다.
 *
 * Every other member column -- email, phone, address, contracts, salary,
 * 인사노트 etc. -- stays behind the password gate and is only reachable via
 * /api/all. Do not widen the SELECT below beyond id/name/team/position.
 */

import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [members, okrs, okrTasks, evals, calibrationCycles, calibrationOverrides, oneonones] = await Promise.all([
      sql`SELECT id, name, team, position FROM members ORDER BY name`,
      sql`SELECT * FROM okrs`,
      sql`SELECT * FROM okr_tasks`,
      sql`SELECT * FROM evals`,
      sql`SELECT * FROM calibration_cycles`,
      sql`SELECT * FROM calibration_overrides`,
      sql`SELECT * FROM oneonones ORDER BY date`
    ]);

    const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

    const okrs_out = okrs.map(o => ({
      id: o.id, quarter: o.quarter, month: o.month, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, member: o.member_id, part: o.part || '', progress: o.progress, unit: o.unit, target: o.target,
      status: o.status || 'approved', reviewNote: o.review_note || ''
    }));

    const okrTasks_out = okrTasks.map(t => ({ id: t.id, okrId: t.okr_id, title: t.title, done: t.done }));

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
      // id, name, team, position ONLY -- see the file header before widening.
      members: members.map(m => ({ id: m.id, name: m.name, team: m.team || '', position: m.position || '' })),
      okrs: okrs_out,
      okrTasks: okrTasks_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load public data' });
  }
}
