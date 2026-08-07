/**
 * handlers/okrs/index.js
 *
 * POST { level:'회사', title, month } -> 201 { id }
 * POST { level:'조직', title, month, parent, owner, part } -> 201 { id }
 *
 * 개인(level:'개인') 목표는 여기서 만들지 않는다 — 로그인한 본인 명의로만
 * 만들어져야 하므로 /api/my-goals를 쓴다(handlers/my-goals/index.js).
 *
 * 2026-08-04: 지금까지 이 엔드포인트는 로그인 여부와 무관하게 누구나 호출할
 * 수 있었다. 목표 탭을 역할(관리자/부서장/팀원) 기반으로 재설계하면서 실제
 * 권한 검사를 추가한다 — 회사 목표는 roles에 '관리자'가 있는 사람만, 부서
 * 목표는 roles에 '부서장'이 있으면서 그 팀 소속인 사람만 만들 수 있다
 * (docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md 참고).
 *
 * 2026-08-05: role(단일 값) -> roles(배열)로 변경 — 관리자이면서 동시에 자기
 * 팀의 부서장인 실사용 사례(예: 인사팀장)가 나와서, 한 사람이 관리자/부서장을
 * 동시에 가질 수 있게 했다.
 *
 * 부서(조직) 목표는 반드시 "같은 달"의 기업(회사) 목표를 상위로 선택해야
 * 하고, 같은 팀(owner)·같은 달(month)·같은 파트(part)에 5개를 넘게 만들 수
 * 없다. part는 한 팀 안에 기능이 나뉘는 경우(예: 인사회계팀의 인사/회계)를
 * 위한 자유 텍스트 태그로, 없으면 빈 문자열이다.
 *
 * 회사/부서 목표 모두 "이번 달 또는 지난달"만 만들 수 있다(isEditableMonth).
 *
 * 2026-08-06: 가중치(weight) 도입. 사용자가 정의한 성과관리 매커니즘 —
 * 같은 레벨끼리(기업 목표는 기업 목표끼리, 한 부서의 부서 목표는 그
 * 부서끼리) 가중치 합이 100%를 넘을 수 없다. weight는 선택 입력이라
 * 안 주면 null("가중치 설정 중" 상태)로 저장한다. 이 시점부터 기업 목표는
 * 평가기간(월) 기준 최대 3개로 제한한다(전에는 상한이 없었다 — 전체현황
 * 화면 재설계 요청에서 명시적으로 다시 확인된 규칙).
 *
 * 2026-08-06(부서목표 화면 재설계): 부서 목표 월 상한을 팀·달·파트당 5개 ->
 * 10개로 올렸다(사용자가 화면 시안에서 "월 최대 10개"를 명시). 그리고
 * 관리자는 부서장이 아니어도, 본인 팀이 아니어도 아무 부서 목표나 수정·
 * 삭제할 수 있게 됐다(handlers/okrs/[id].js) — 다만 "생성"은 여전히 그 팀의
 * 부서장만 할 수 있다. 관리자가 임의의 팀을 골라 새로 만드는 화면은 아직
 * 없어서(요청받은 적 없음), 생성 권한까지 넓히면 그 UI 없이는 쓸 수 없는
 * 반쪽짜리 기능이 되기 때문이다.
 *
 * 2026-08-07(기간형 기업 목표): 회사 목표는 이제 매달 새로 만들지 않고
 * period_type/start_date/end_date로 기간을 한 번 설정해서 여러 달에 걸쳐
 * 같은 목표를 유지할 수 있다(POST body에 periodType/startDate/endDate가
 * 오면 저장하고, 안 오면 기존처럼 그 달 하루짜리 목표로 취급 — 완전히
 * 하위 호환). "최대 3개·가중치 합 100%" 검증은 이제 "정확히 같은 달"이
 * 아니라 handlers/_lib/goalPeriod.js의 기간 겹침 기준으로 한다 — 반기
 * 목표(7~12월)가 있으면 그 6개월 동안 다른 회사 목표를 새로 만들 때도
 * 같은 3개/100% 예산을 나눠 써야 하기 때문이다. month는 여전히 필수로
 * 받는다 — 그 값이 기간의 시작월이자 "이번 달/지난달에만 새로 만들 수
 * 있다"는 기존 규칙이 적용되는 기준이 된다. 부서(조직) 목표는 이 변경의
 * 영향을 받지 않는다 — 다만 상위 기업 목표가 이제 여러 달짜리일 수 있어서,
 * "상위 기업 목표와 같은 달" 체크를 "상위 기업 목표 기간에 포함되는 달"
 * 체크로 바꿨다(부서 목표 생성 방식 자체는 그대로다).
 */
import { sql } from '../_lib/db.js';
import { getSessionMemberId } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';
import { deriveGoalPeriod, monthRange, periodsOverlap, monthOverlapsGoal } from '../_lib/goalPeriod.js';

// '2026-08' -> '2026-Q3'
function quarterFromMonth(month) {
  const [year, m] = month.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${year}-Q${q}`;
}

// { weight: number|null } 또는 { error: string }
function parseWeight(raw) {
  if (raw === undefined || raw === null || raw === '') return { weight: null };
  const w = Number(raw);
  if (!Number.isInteger(w) || w < 0 || w > 100) return { error: '가중치는 0~100 사이 정수여야 해요' };
  return { weight: w };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const memberId = getSessionMemberId(req);
  if (!memberId) return res.status(401).json({ error: '로그인이 필요해요' });

  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
  if (b.level === '개인') return res.status(400).json({ error: '개인 목표는 /api/my-goals로 만들어주세요' });
  if (b.level !== '회사' && b.level !== '조직') return res.status(400).json({ error: 'level must be 회사 or 조직' });
  if (!b.month) return res.status(400).json({ error: '월을 선택해주세요' });
  if (!isEditableMonth(b.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 만들 수 있어요' });

  try {
    // 세션 검사(getSessionMemberId)는 DB에 접근하지 않지만, 이 조회는 접근하므로
    // try 안에서 실행해 일시적인 DB 오류도 나머지 코드와 같은 500 JSON 응답으로
    // 처리되게 한다(전에는 try 시작 전에 있어서 그런 오류가 처리 안 된 예외로
    // 튀어나갔다).
    const [me] = await sql`SELECT roles, team FROM members WHERE id = ${memberId}`;
    if (!me) return res.status(401).json({ error: '로그인이 필요해요' });
    const roles = me.roles || [];

    const { weight, error: weightErr } = parseWeight(b.weight);
    if (weightErr) return res.status(400).json({ error: weightErr });

    if (b.level === '조직') {
      if (!roles.includes('부서장')) return res.status(403).json({ error: '부서 목표는 부서장만 만들 수 있어요' });

      const owner = (b.owner || '-').trim() || '-';
      if (owner !== me.team) return res.status(403).json({ error: '본인 팀 목표만 만들 수 있어요' });

      if (!b.parent) return res.status(400).json({ error: '상위 기업 목표를 선택해주세요' });
      const [parent] = await sql`SELECT id, level, month, start_date::text AS start_date, end_date::text AS end_date FROM okrs WHERE id = ${b.parent}`;
      if (!parent || parent.level !== '회사') {
        return res.status(400).json({ error: '상위 목표는 기업 목표여야 해요' });
      }
      if (!monthOverlapsGoal(b.month, parent)) {
        return res.status(400).json({ error: '상위 기업 목표의 목표 기간에 포함되는 달로 맞춰주세요' });
      }

      const part = (b.part || '').trim();
      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM okrs
        WHERE level = '조직' AND owner = ${owner} AND month = ${b.month} AND part = ${part}`;
      if (count >= 10) {
        return res.status(400).json({ error: `${owner}${part ? ' · ' + part : ''} 팀은 ${b.month}에 이미 목표가 10개 있어요` });
      }

      if (weight !== null) {
        const [{ sum }] = await sql`
          SELECT COALESCE(SUM(weight), 0)::int AS sum FROM okrs
          WHERE level = '조직' AND owner = ${owner} AND month = ${b.month} AND part = ${part} AND weight IS NOT NULL`;
        if (sum + weight > 100) {
          return res.status(400).json({ error: `${owner}${part ? ' · ' + part : ''} 팀의 ${b.month} 가중치 합계가 100%를 넘어요 (현재 ${sum}% + ${weight}%)` });
        }
      }

      const [row] = await sql`
        INSERT INTO okrs (quarter, month, level, title, owner, parent_id, part, weight, progress, unit, target)
        VALUES (${quarterFromMonth(b.month)}, ${b.month}, '조직', ${b.title.trim()}, ${owner}, ${b.parent}, ${part}, ${weight}, 0, '%', 100)
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    }

    // 회사
    if (!roles.includes('관리자')) return res.status(403).json({ error: '회사 목표는 관리자만 만들 수 있어요' });

    const periodType = b.periodType ? String(b.periodType).trim() : null;
    const startDate = b.startDate || null;
    const endDate = b.endDate || null;
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({ error: '시작일과 종료일을 함께 입력해주세요' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: '종료일은 시작일보다 빠를 수 없어요' });
    }
    const newPeriod = startDate && endDate ? { start: startDate, end: endDate } : monthRange(b.month);

    const existingCompanies = await sql`SELECT id, month, start_date::text AS start_date, end_date::text AS end_date, weight FROM okrs WHERE level = '회사'`;
    const overlapping = existingCompanies.filter(o => periodsOverlap(newPeriod, deriveGoalPeriod(o)));
    if (overlapping.length >= 3) {
      return res.status(400).json({ error: '같은 기간에 이미 기업 목표가 3개 있어요 (최대 3개)' });
    }
    if (weight !== null) {
      const sum = overlapping.reduce((a, o) => a + (o.weight || 0), 0);
      if (sum + weight > 100) {
        return res.status(400).json({ error: `같은 기간의 기업 목표 가중치 합계가 100%를 넘어요 (현재 ${sum}% + ${weight}%)` });
      }
    }

    const unit = (b.unit || '').trim() || '%';
    const target = b.target === undefined || b.target === null || b.target === '' ? 100 : Number(b.target);
    if (!Number.isInteger(target)) return res.status(400).json({ error: '최종 목표값은 정수여야 해요' });

    const [row] = await sql`
      INSERT INTO okrs (quarter, month, level, title, owner, weight, progress, unit, target, period_type, start_date, end_date)
      VALUES (${quarterFromMonth(b.month)}, ${b.month}, '회사', ${b.title.trim()}, '전사', ${weight}, 0, ${unit}, ${target}, ${periodType}, ${startDate}, ${endDate})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
