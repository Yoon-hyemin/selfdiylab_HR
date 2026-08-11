/**
 * handlers/okrs/[id].js
 *
 * PATCH { title?, weight?, periodType?, startDate?, endDate? } -> 200 { ok: true }
 *   회사/부서 목표 제목·가중치 수정 (periodType/startDate/endDate는 회사 목표만 해당)
 * DELETE                    -> 200 { ok: true }   회사/부서 목표 삭제
 *
 * 2026-08-06: 목표를 한번 만들면 고치거나 지울 방법이 없던 걸 채워 넣는다.
 * 권한은 생성 때와 동일하다 — 회사 목표는 roles에 '관리자'가 있는 사람만,
 * 부서 목표는 roles에 '부서장'이 있으면서 그 팀(owner) 소속인 사람만. 개인
 * 목표는 이 엔드포인트에서 다루지 않는다(handlers/my-goals/[id].js 참고).
 *
 * 삭제 시 하위 목표(조직 목표를 상위로 둔 개인 목표, 회사 목표를 상위로 둔
 * 조직 목표)는 지우지 않는다 — sql/001_schema.sql의 okrs.parent_id가
 * ON DELETE SET NULL이라 하위 목표는 그대로 남고 상위 연결만 끊긴다(개인
 * 목표라면 본인 "개인 목표" 탭에 계속 보인다). 기업 목표의 월별 진행기록은
 * okr_monthly_progress.okr_id가 ON DELETE CASCADE라 같이 지워진다.
 *
 * weight 수정 시 handlers/okrs/index.js의 생성 검증과 같은 스코프(회사는
 * 기간 겹침 전체, 조직은 팀+달+파트)로 합계 100% 검증을 하되, 자기 자신의
 * 기존 weight는 합계에서 빼고 계산한다(그래야 이미 배분된 가중치를 그대로
 * 두는 PATCH가 "자기 자신과 중복 계산돼서" 부당하게 거부되지 않는다).
 *
 * 2026-08-06(부서목표 화면 재설계): 관리자는 부서 목표를 팀 소속과 무관하게
 * 수정·삭제할 수 있다("대표·관리자: 모든 부서 목표 수정" 요구사항). 부서장은
 * 여전히 본인 팀 것만 가능하다. 생성(POST /api/okrs)은 이 변경 대상이
 * 아니다 — 관리자가 임의 팀을 골라 새로 만드는 화면이 없어서, 권한만
 * 넓히면 쓸 수 없는 기능이 된다.
 *
 * 2026-08-07(기간형 기업 목표, 1차): 회사 목표의 weight 재검증 스코프를
 * "정확히 같은 달"에서 handlers/okrs/index.js와 같은 기간 겹침 기준으로
 * 바꿨다. 이때는 기간(period_type/start_date/end_date) 자체는 고치지 못하게
 * 막아뒀었다.
 *
 * 2026-08-07(2차, 기간 수정 허용): "기간을 한번 정하면 못 고친다"가 실제로는
 * "기간을 바꾸려면 목표를 지웠다 다시 만들어야 하고, 그러면 이미 연결된
 * 부서 목표(parent_id)와 월별 진행기록이 통째로 날아간다"는 운영상 문제로
 * 이어진다는 피드백을 받아 회사 목표에 한해 기간 수정을 허용한다. 부서
 * 목표는 parent_id로 회사 목표 id만 참조하고 있어서(기간 자체를 복사해
 * 저장하지 않음) 기간을 바꿔도 기존 연결은 끊기지 않는다 — 다만 새 기간이
 * 부서 목표가 붙어있던 달을 더는 포함하지 않으면 그 달에는 "겹치는 회사
 * 목표 없음" 상태로 화면에서 보이게 된다(연결 자체는 그대로 유지).
 * 기간을 바꾸면 최대 3개/가중치 100% 제약도 새 기간 기준으로 다시 검사한다
 * (생성 시 로직과 동일, 자기 자신은 제외).
 *
 * 또한 이번에 회사 목표의 "이번 달/지난달만 수정 가능" 제한을
 * isCompanyGoalEditableNow()로 바꿨다 — 기존 isEditableMonth(okr.month)는
 * "생성월" 하나만 보기 때문에, 반기/연간처럼 여러 달짜리 회사 목표는 만든 지
 * 2달만 지나도 제목·가중치·기간을 영원히 못 고치게 막아버리는 문제가 있었다
 * (바로 이번에 고치려는 "기간 수정"이 필요한 시점에 걸릴 수 있는 버그). 회사
 * 목표는 이제 "목표 기간이 끝난 지 1개월 이내"까지 수정 가능하다(기존
 * 이번달/지난달 여유분과 같은 폭). 조직(부서) 목표는 여전히 매달 만드는
 * 구조라 isEditableMonth(okr.month) 그대로 유지한다.
 */
import { sql } from '../_lib/db.js';
import { requireAuth } from '../_lib/accountAuth.js';
import { isEditableMonth, currentMonthKey } from '../_lib/monthWindow.js';
import { deriveGoalPeriod, periodsOverlap, monthRange, isCompanyGoalEditableNow, monthOverlapsGoal } from '../_lib/goalPeriod.js';

function parseWeight(raw) {
  if (raw === undefined) return { skip: true };
  if (raw === null || raw === '') return { weight: null };
  const w = Number(raw);
  if (!Number.isInteger(w) || w < 0 || w > 100) return { error: '가중치는 0~100 사이 정수여야 해요' };
  return { weight: w };
}

async function loadOkrAndCheckPermission(id, account) {
  const [okr] = await sql`SELECT id, level, owner, month, part, weight, parent_id, period_type, start_date::text AS start_date, end_date::text AS end_date FROM okrs WHERE id = ${id}`;
  if (!okr) return { error: [404, '목표를 찾을 수 없어요'] };
  if (okr.level === '개인') return { error: [400, '개인 목표는 /api/my-goals로 수정/삭제해주세요'] };

  const isAdmin = account.system_role === 'ADMIN';
  if (okr.level === '회사' && !isAdmin) {
    return { error: [403, '회사 목표는 관리자만 수정/삭제할 수 있어요'] };
  }
  if (okr.level === '조직' && !isAdmin) {
    if (account.system_role !== 'DEPARTMENT_HEAD') return { error: [403, '부서 목표는 부서장만 수정/삭제할 수 있어요'] };
    if (okr.owner !== account.department_id) return { error: [403, '본인 팀 목표만 수정/삭제할 수 있어요'] };
  }

  if (okr.level === '회사') {
    if (!isCompanyGoalEditableNow(okr, currentMonthKey())) {
      return { error: [400, '목표 기간이 끝난 지 오래돼 수정/삭제할 수 없어요'] };
    }
  } else if (!isEditableMonth(okr.month)) {
    return { error: [400, '이번 달/지난달 목표만 수정/삭제할 수 있어요'] };
  }

  return { okr };
}

export default async function handler(req, res) {
  const { id } = req.query;
  const account = await requireAuth(req, res);
  if (!account) return;

  try {
    const { okr, error } = await loadOkrAndCheckPermission(id, account);
    if (error) return res.status(error[0]).json({ error: error[1] });

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const title = (body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title is required' });

      const { weight, error: weightErr, skip: skipWeight } = parseWeight(body.weight);
      if (weightErr) return res.status(400).json({ error: weightErr });

      // 회사 목표만 기간 수정 대상 -- body에 세 필드 중 하나라도 오면 셋 다 새 값으로 취급한다.
      const periodProvided = okr.level === '회사' && (body.periodType !== undefined || body.startDate !== undefined || body.endDate !== undefined);
      let periodType = okr.period_type, startDate = okr.start_date, endDate = okr.end_date;
      if (periodProvided) {
        periodType = body.periodType ? String(body.periodType).trim() : null;
        startDate = body.startDate || null;
        endDate = body.endDate || null;
        if ((startDate && !endDate) || (!startDate && endDate)) {
          return res.status(400).json({ error: '시작일과 종료일을 함께 입력해주세요' });
        }
        if (startDate && endDate && startDate > endDate) {
          return res.status(400).json({ error: '종료일은 시작일보다 빠를 수 없어요' });
        }
      }

      if (okr.level === '회사') {
        const myPeriod = startDate && endDate ? { start: startDate, end: endDate } : monthRange(okr.month);
        const others = await sql`SELECT month, start_date::text AS start_date, end_date::text AS end_date, weight FROM okrs WHERE level = '회사' AND id != ${okr.id}`;
        const overlapping = others.filter(o => periodsOverlap(myPeriod, deriveGoalPeriod(o)));
        if (periodProvided && overlapping.length >= 3) {
          return res.status(400).json({ error: '같은 기간에 이미 기업 목표가 3개 있어요 (최대 3개)' });
        }
        if (!skipWeight && weight !== null) {
          const sum = overlapping.filter(o => o.weight !== null).reduce((a, o) => a + o.weight, 0);
          if (sum + weight > 100) {
            return res.status(400).json({ error: `같은 기간의 기업 목표 가중치 합계가 100%를 넘어요 (다른 목표 ${sum}% + ${weight}%)` });
          }
        }
      } else if (!skipWeight && weight !== null) {
        const part = okr.part || '';
        const [row] = await sql`SELECT COALESCE(SUM(weight), 0)::int AS sum FROM okrs WHERE level = '조직' AND owner = ${okr.owner} AND month = ${okr.month} AND part = ${part} AND weight IS NOT NULL AND id != ${okr.id}`;
        if (row.sum + weight > 100) {
          return res.status(400).json({ error: `가중치 합계가 100%를 넘어요 (다른 목표 ${row.sum}% + ${weight}%)` });
        }
      }

      // 2026-08-11: 부서 목표에 상위 기업 목표를 (다시) 연결하는 기능 --
      // 기존 목표는 생성 시 항상 parent가 필수였어서 지금 이걸 쓸 데이터는
      // 없지만, "상위 목표를 다른 것으로 이동" 삭제 절차나, 혹시 모를
      // 미연결 상태를 관리자가 직접 고칠 수 있어야 한다는 요구사항 때문에
      // 넣었다. 회사 목표에는 상위 개념이 없어서 조직 레벨에서만 받는다.
      let newParentId = okr.parent_id;
      if (okr.level === '조직' && body.parentId !== undefined) {
        if (body.parentId === null || body.parentId === '') {
          newParentId = null;
        } else {
          const [newParent] = await sql`SELECT id, level, start_date::text AS start_date, end_date::text AS end_date, month FROM okrs WHERE id = ${body.parentId}`;
          if (!newParent || newParent.level !== '회사') {
            return res.status(400).json({ error: '상위 목표는 기업 목표여야 해요' });
          }
          if (!monthOverlapsGoal(okr.month, newParent)) {
            return res.status(400).json({ error: '상위 기업 목표의 목표 기간에 포함되는 달이어야 해요' });
          }
          newParentId = newParent.id;
        }
      }

      const newWeight = skipWeight ? okr.weight : weight;
      await sql`UPDATE okrs SET title = ${title}, weight = ${newWeight}, parent_id = ${newParentId}, period_type = ${periodType}, start_date = ${startDate}, end_date = ${endDate} WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      // 2026-08-11: 하위 목표(회사 목표라면 부서 목표, 부서 목표라면 개인
      // 목표)가 연결돼 있으면 그냥 지우지 않는다 -- 예전엔 parent_id가
      // ON DELETE SET NULL이라 조용히 연결만 끊고 삭제됐는데, 사용자가
      // 지우기 전에 명시적으로 "이동/연결 해제/취소"를 고르게 해달라고
      // 요청해서 그 앞단에 확인 절차를 추가했다.
      const children = await sql`SELECT id FROM okrs WHERE parent_id = ${okr.id}`;
      const body = req.body || {};
      const onChildren = body.onChildren; // 'unlink' | 'reassign' | undefined

      if (children.length > 0 && onChildren !== 'unlink' && onChildren !== 'reassign') {
        return res.status(409).json({
          error: `연결된 하위 목표가 ${children.length}개 있어요. 이동하거나 연결을 해제한 뒤 삭제해주세요`,
          childCount: children.length
        });
      }

      if (children.length > 0 && onChildren === 'reassign') {
        const newParentId = body.newParentId;
        if (!newParentId) return res.status(400).json({ error: '이동할 상위 목표를 선택해주세요' });
        const [newParent] = await sql`SELECT id, level FROM okrs WHERE id = ${newParentId}`;
        if (!newParent || newParent.level !== okr.level) {
          return res.status(400).json({ error: '올바르지 않은 이동 대상이에요' });
        }
        await sql`UPDATE okrs SET parent_id = ${newParentId} WHERE parent_id = ${okr.id}`;
      }
      // onChildren === 'unlink'(또는 애초에 하위 목표가 없던 경우)는 그대로
      // 진행 -- ON DELETE SET NULL이 하위 목표의 parent_id를 알아서 비운다.

      await sql`DELETE FROM okrs WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update OKR' });
  }
}
