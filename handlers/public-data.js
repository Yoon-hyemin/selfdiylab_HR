/**
 * handlers/public-data.js
 *
 * GET -> { members, okrs, okrTasks, okrProgress, evals, calibration, oneonones, revenueTargets, revenueMonthly }
 *
 * 2026-08-12: revenueTargets/revenueMonthly("매출 달성" 탭)는 KPI(okrs)와
 * 무관한 별도 테이블이고, role 필터링 없이 로그인한 사람 전원에게 그대로
 * 내려준다("전체 구성원 조회 가능, 관리자만 입력/확정" 요구사항 -- 조회는
 * 역할 제한이 없고 수정만 handlers/revenue/*.js에서 ADMIN으로 막는다).
 *
 * 2026-08-11(개인 계정 로그인 도입): 파일 이름은 여전히 "public-data"이지만
 * 더 이상 공개(비로그인) 엔드포인트가 아니다 -- 로그인한 계정이면 역할
 * 무관하게 호출할 수 있되, 응답 내용은 역할에 따라 걸러진다:
 *
 *   - 기업(회사)/부서(조직) 레벨 목표는 그대로 전원에게 공개한다. 전체현황
 *     탭의 "전 부서 비교" 차트가 애초에 이 전제로 만들어져 있고, 새 스펙의
 *     "다른 부서 데이터 접근 불가" 제한은 개인 식별이 가능한 데이터(개인
 *     목표/평가/원온원)에 대한 것으로 해석했다 -- 자세한 근거는 최종 보고
 *     참고.
 *   - 개인 레벨 목표/평가/원온원/등급배분은 본인 것 또는(부서장일 때) 같은
 *     팀 구성원 것만 내려준다. 관리자는 전부 본다(다만 관리자는 보통
 *     /api/all을 쓰므로 이 엔드포인트에서도 동일하게 전체를 주는 건 방어적
 *     일관성 차원).
 *
 * URL을 그대로 유지하는 이유: 프론트가 이미 이 경로로 광범위하게
 * fetch하고 있어서, 엔드포인트 이름을 바꾸면 그 호출부를 전부 찾아 고쳐야
 * 하는 불필요한 변경이 늘어난다(기존 구조 최대한 유지 원칙).
 *
 * members는 이름/팀/직책만 내려준다 -- 급여·주소 같은 민감 정보는 여전히
 * /api/all(관리자 전용)에서만 나간다.
 */

import { sql } from './_lib/db.js';
import { requireAuth } from './_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireAuth(req, res);
  if (!account) return;

  try {
    const [members, okrs, okrTasks, okrProgress, evals, calibrationCycles, calibrationOverrides, oneonones,
      revenueTargets, revenueMonthly] = await Promise.all([
      sql`SELECT id, name, team, position FROM members ORDER BY name`,
      sql`SELECT *, start_date::text AS start_date_txt, end_date::text AS end_date_txt FROM okrs`,
      sql`SELECT * FROM okr_tasks`,
      sql`SELECT * FROM okr_monthly_progress`,
      sql`SELECT * FROM evals`,
      sql`SELECT * FROM calibration_cycles`,
      sql`SELECT * FROM calibration_overrides`,
      sql`SELECT * FROM oneonones ORDER BY date`,
      sql`SELECT * FROM revenue_targets ORDER BY year`,
      sql`SELECT * FROM revenue_monthly ORDER BY year, month`
    ]);

    const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));
    const memberTeamById = Object.fromEntries(members.map(m => [m.id, m.team || '']));

    // 개인 식별이 가능한 레코드(개인 목표/평가/원온원)만 역할에 따라 거른다.
    // 회사/부서 레벨 목표는 필터링 없이 그대로 둔다.
    const canSeeEmployeeRecord = (employeeId) => {
      if (account.system_role === 'ADMIN') return true;
      if (account.employee_id === employeeId) return true;
      if (account.system_role === 'DEPARTMENT_HEAD') return memberTeamById[employeeId] === account.department_id;
      return false;
    };

    const visibleOkrs = okrs.filter(o => o.level !== '개인' || canSeeEmployeeRecord(o.member_id));
    const visibleOkrIds = new Set(visibleOkrs.map(o => o.id));

    const okrs_out = visibleOkrs.map(o => ({
      id: o.id, quarter: o.quarter, month: o.month, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, member: o.member_id, part: o.part || '', progress: o.progress, unit: o.unit, target: o.target,
      status: o.status || 'approved', reviewNote: o.review_note || '', weight: o.weight === null || o.weight === undefined ? null : o.weight,
      createdAt: o.created_at, periodType: o.period_type || null, startDate: o.start_date_txt, endDate: o.end_date_txt
    }));

    const okrTasks_out = okrTasks.filter(t => visibleOkrIds.has(t.okr_id)).map(t => ({ id: t.id, okrId: t.okr_id, title: t.title, done: t.done }));

    const okrProgress_out = okrProgress.map(p => ({
      id: p.id, okrId: p.okr_id, year: p.year, month: p.month,
      monthlyTargetValue: p.monthly_target_value === null ? null : Number(p.monthly_target_value),
      monthlyActualValue: p.monthly_actual_value === null ? null : Number(p.monthly_actual_value),
      status: p.status || '', note: p.note || ''
    }));

    const visibleEvals = evals.filter(e => canSeeEmployeeRecord(e.employee_id));
    const visibleEvalIds = new Set(visibleEvals.map(e => e.id));
    const evals_out = visibleEvals.map(e => ({
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
      if (calibration_out[o.quarter] && visibleEvalIds.has(o.eval_id)) {
        calibration_out[o.quarter].overrides[o.eval_id] = { grade: o.grade, reason: o.reason };
      }
    }

    const oneonones_out = oneonones.filter(m => canSeeEmployeeRecord(m.employee_id)).map(m => ({
      id: m.id, employee: m.employee_id, employeeName: memberNameById[m.employee_id] || '(삭제된 구성원)',
      date: m.date, note: m.note
    }));

    const revenueTargets_out = revenueTargets.map(r => ({
      year: r.year, annualTarget: Number(r.annual_target),
      baseCumulativeActual: Number(r.base_cumulative_actual), baseThroughMonth: r.base_through_month
    }));
    const revenueMonthly_out = revenueMonthly.map(r => ({
      id: r.id, year: r.year, month: r.month,
      monthlyTarget: r.monthly_target === null ? null : Number(r.monthly_target),
      monthlyActual: r.monthly_actual === null ? null : Number(r.monthly_actual),
      status: r.status, note: r.note || ''
    }));

    res.status(200).json({
      members: members.map(m => ({ id: m.id, name: m.name, team: m.team || '', position: m.position || '' })),
      okrs: okrs_out,
      okrTasks: okrTasks_out,
      okrProgress: okrProgress_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out,
      revenueTargets: revenueTargets_out,
      revenueMonthly: revenueMonthly_out
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load public data' });
  }
}
