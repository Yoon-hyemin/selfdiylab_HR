import { sql } from './_lib/db.js';
import { requireRole } from './_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireRole(req, res, ['ADMIN']))) return;

  try {
    const [members, leaveHistory, awards, discipline, career, education, family,
      holidays, jobs, candidates, candidateHistory, okrs, okrTasks, okrProgress, evals, calibrationCycles,
      calibrationOverrides, oneonones, revenueTargets, revenueMonthly, companyContributions] = await Promise.all([
      sql`SELECT * FROM members ORDER BY name`,
      sql`SELECT * FROM member_leave_history`,
      sql`SELECT * FROM member_awards`,
      sql`SELECT * FROM member_discipline`,
      sql`SELECT * FROM member_career`,
      sql`SELECT * FROM member_education`,
      sql`SELECT * FROM member_family`,
      sql`SELECT * FROM holidays ORDER BY id`,
      sql`SELECT * FROM jobs ORDER BY created_at DESC`,
      sql`SELECT * FROM candidates ORDER BY created_at`,
      sql`SELECT * FROM candidate_history ORDER BY date`,
      sql`SELECT *, start_date::text AS start_date_txt, end_date::text AS end_date_txt FROM okrs`,
      sql`SELECT * FROM okr_tasks`,
      sql`SELECT * FROM okr_monthly_progress`,
      sql`SELECT * FROM evals`,
      sql`SELECT * FROM calibration_cycles`,
      sql`SELECT * FROM calibration_overrides`,
      sql`SELECT * FROM oneonones ORDER BY date`,
      sql`SELECT * FROM revenue_targets ORDER BY year`,
      sql`SELECT * FROM revenue_monthly ORDER BY year, month`,
      sql`SELECT * FROM company_goal_dept_contributions`
    ]);

    const holidayNames = holidays.map(h => h.name);
    const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

    const members_out = members.map(m => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname || '',
      roles: m.roles && m.roles.length ? m.roles : ['팀원'],
      team: m.team || '',
      position: m.position || '',
      email: m.email || '',
      personalEmail: m.personal_email || '',
      employeeNo: m.employee_no || '',
      hireDate: m.hire_date,
      groupHireDate: m.group_hire_date,
      hireType: m.hire_type || '',
      birthday: m.birthday,
      phone: m.phone || '',
      address: m.address || '',
      laborContract: m.labor_contract || '',
      wageContract: m.wage_contract || '',
      salaryPayInfo: m.salary_pay_info || '',
      workType: { name: m.work_type_name, fixed: m.work_type_fixed, hours: m.work_type_hours },
      overtimePolicy: m.overtime_policy || '',
      leavePolicy: { basis: m.leave_policy_basis, halfDay: m.leave_policy_half_day, promotion: m.leave_policy_promotion },
      restDays: holidayNames,
      leaveHistory: leaveHistory.filter(r => r.member_id === m.id).map(r => ({ reason: r.reason, period: r.period })),
      awards: awards.filter(r => r.member_id === m.id).map(r => ({ title: r.title, date: r.date })),
      discipline: discipline.filter(r => r.member_id === m.id).map(r => ({ reason: r.reason, date: r.date })),
      career: career.filter(r => r.member_id === m.id).map(r => ({ company: r.company, role: r.role, period: r.period })),
      education: education.filter(r => r.member_id === m.id).map(r => ({ school: r.school, major: r.major, period: r.period })),
      family: family.filter(r => r.member_id === m.id).map(r => ({ name: r.name, relation: r.relation })),
      specialNotes: m.special_notes || '',
      deduction: { basic: m.deduction_basic, healthDependents: m.deduction_health_dependents },
      hrInfo: m.hr_info || '',
      intro: m.intro || '',
      workedHours: m.worked_hours || '',
      leaveLeft: m.leave_left || ''
    }));

    const jobs_out = jobs.map(j => ({
      id: j.id, title: j.title, team: j.team, deadline: j.deadline, status: j.status,
      stages: j.stages, submissionDocs: j.submission_docs, preQuestions: j.pre_questions, extraInfo: j.extra_info
    }));

    const candidates_out = candidates.map(c => ({
      id: c.id, jobId: c.job_id, name: c.name, phone: c.phone, email: c.email, selfIntro: c.self_intro, stage: c.stage,
      history: candidateHistory.filter(h => h.candidate_id === c.id).map(h => ({ date: h.date, stage: h.stage, note: h.note }))
    }));

    const okrs_out = okrs.map(o => ({
      id: o.id, quarter: o.quarter, month: o.month, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, member: o.member_id, part: o.part || '', progress: o.progress, unit: o.unit, target: o.target,
      status: o.status || 'approved', reviewNote: o.review_note || '', weight: o.weight === null || o.weight === undefined ? null : o.weight,
      createdAt: o.created_at, periodType: o.period_type || null, startDate: o.start_date_txt, endDate: o.end_date_txt
    }));

    const okrTasks_out = okrTasks.map(t => ({ id: t.id, okrId: t.okr_id, title: t.title, done: t.done }));

    const okrProgress_out = okrProgress.map(p => ({
      id: p.id, okrId: p.okr_id, year: p.year, month: p.month,
      monthlyTargetValue: p.monthly_target_value === null ? null : Number(p.monthly_target_value),
      monthlyActualValue: p.monthly_actual_value === null ? null : Number(p.monthly_actual_value),
      status: p.status || '', note: p.note || ''
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
    const companyContributions_out = companyContributions.map(r => ({
      companyOkrId: r.company_okr_id, team: r.team, contribution: r.contribution
    }));

    res.status(200).json({
      members: members_out,
      jobs: jobs_out,
      candidates: candidates_out,
      okrs: okrs_out,
      okrTasks: okrTasks_out,
      okrProgress: okrProgress_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out,
      revenueTargets: revenueTargets_out,
      revenueMonthly: revenueMonthly_out,
      companyContributions: companyContributions_out
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load data' });
  }
}
