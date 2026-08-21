/**
 * handlers/_lib/talentSearchPolicy.js
 *
 * 인재검색 채점 정책(talent_search_policy_versions) 공용 헬퍼. 1B-2~1B-3까지는
 * "수정 = 새 버전을 만들어 즉시 활성화"(createPolicyVersion)였는데, 1B-4a부터는
 * 저장과 적용을 분리한다 -- 카드 저장은 초안(status='draft')에만 반영되고,
 * 별도의 "적용하기"를 거쳐야 실제 활성 버전이 바뀐다. 초안은 전역에서 한 번에
 * 하나만 존재한다: 이미 초안이 있으면 그 행을 그대로 UPDATE(병합)하고, 없으면
 * 활성 버전을 베이스로 새 초안 행을 만든다. 1B-4b부터는 여기에 버전 이력
 * 조회(listPolicyVersions)와 과거 버전 복구(restoreVersionAsDraft)가 추가된다
 * -- 복구도 "새 초안 만들기"지만 기존 초안을 병합이 아니라 완전히 대체해야
 * 하고 그 삭제+삽입이 원자적이어야 해서, saveDraftOverrides가 쓰는
 * insertNewDraft 헬퍼 대신 자체 sql.transaction으로 처리한다.
 */
import { sql } from './db.js';
import { requireTalentSearchAccess } from './accountAuth.js';
import { validateOverrideKeys } from './talentSearchPolicyValidate.js';

export function policy_out(row) {
  return {
    id: row.id,
    versionNo: row.version_no,
    level1Rules: row.level1_rules,
    commonFitWeights: row.common_fit_weights,
    evidenceCoefficients: row.evidence_coefficients,
    jobFitDefaultWeights: row.job_fit_default_weights,
    roundingRule: row.rounding_rule,
    thresholds: row.thresholds,
    sortTiebreakRules: row.sort_tiebreak_rules,
    dailyRecommendCapDefault: row.daily_recommend_cap_default,
    dailyRecommendCapAbsoluteMax: row.daily_recommend_cap_absolute_max,
    dataRetentionMonths: row.data_retention_months,
    status: row.status,
    changeReason: row.change_reason,
    appliedAt: row.applied_at,
    createdAt: row.created_at
  };
}

export async function getActivePolicy() {
  const [row] = await sql`
    SELECT * FROM talent_search_policy_versions WHERE status = 'active'
    ORDER BY version_no DESC LIMIT 1`;
  return row || null;
}

export async function getDraftPolicy() {
  const [row] = await sql`
    SELECT * FROM talent_search_policy_versions WHERE status = 'draft'
    ORDER BY version_no DESC LIMIT 1`;
  return row || null;
}

// base(snake_case row 모양)의 필드값을 그대로 복사해 새 초안 행을 INSERT한다
// (version_no는 현재 최댓값+1). saveDraftOverrides(초안이 아직 없을 때)가 쓴다 --
// 이 함수는 그저 base의 값을 복사할 뿐, 그 값을 기존 초안에 병합할지 통째로
// 대체할지는 호출부가 결정한다(restoreVersionAsDraft는 트랜잭션 안에서 직접
// INSERT하므로 이 함수를 쓰지 않는다 -- 아래 참고).
async function insertNewDraft(base, actorAccountId) {
  const [maxRow] = await sql`SELECT MAX(version_no) AS max FROM talent_search_policy_versions`;
  const nextVersionNo = (maxRow.max || 0) + 1;
  const [inserted] = await sql`
    INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, created_by
    ) VALUES (
      ${nextVersionNo}, ${JSON.stringify(base.level1_rules)}::jsonb,
      ${JSON.stringify(base.common_fit_weights)}::jsonb, ${JSON.stringify(base.evidence_coefficients)}::jsonb,
      ${JSON.stringify(base.job_fit_default_weights)}::jsonb, ${JSON.stringify(base.rounding_rule)}::jsonb,
      ${JSON.stringify(base.thresholds)}::jsonb, ${JSON.stringify(base.sort_tiebreak_rules)}::jsonb,
      ${base.daily_recommend_cap_default}, ${base.daily_recommend_cap_absolute_max},
      ${base.data_retention_months}, 'draft', ${actorAccountId}
    ) RETURNING *`;
  return inserted;
}

// overrides: 바뀌는 필드만 snake_case 키로 담은 객체. 초안이 이미 있으면 그
// 초안 값을 베이스로(활성 버전이 아니라 -- 초안 안에서 여러 카드를 이어서
// 고치는 경우를 위해), 없으면 활성 버전을 베이스로 병합한다.
export async function saveDraftOverrides(overrides, actorAccountId) {
  const keyError = validateOverrideKeys(overrides);
  if (keyError) throw new Error(keyError);

  const draft = await getDraftPolicy();
  const base = draft || await getActivePolicy();
  if (!base) throw new Error('적용 중인 기준이 없어요');
  const next = { ...base, ...overrides };

  if (draft) {
    const [updated] = await sql`
      UPDATE talent_search_policy_versions SET
        level1_rules = ${JSON.stringify(next.level1_rules)}::jsonb,
        common_fit_weights = ${JSON.stringify(next.common_fit_weights)}::jsonb,
        evidence_coefficients = ${JSON.stringify(next.evidence_coefficients)}::jsonb,
        job_fit_default_weights = ${JSON.stringify(next.job_fit_default_weights)}::jsonb,
        rounding_rule = ${JSON.stringify(next.rounding_rule)}::jsonb,
        thresholds = ${JSON.stringify(next.thresholds)}::jsonb,
        sort_tiebreak_rules = ${JSON.stringify(next.sort_tiebreak_rules)}::jsonb,
        daily_recommend_cap_default = ${next.daily_recommend_cap_default},
        daily_recommend_cap_absolute_max = ${next.daily_recommend_cap_absolute_max},
        data_retention_months = ${next.data_retention_months},
        created_by = ${actorAccountId}
      WHERE id = ${draft.id}
      RETURNING *`;
    return updated;
  }

  return insertNewDraft(next, actorAccountId);
}

// 초안을 활성으로 승격. 기존 활성 버전은 superseded로 밀려난다.
export async function applyDraft(changeReason, actorAccountId) {
  const draft = await getDraftPolicy();
  if (!draft) throw new Error('적용할 초안이 없어요');
  const current = await getActivePolicy();
  if (!current) throw new Error('적용 중인 기준이 없어요');

  const result = await sql.transaction([
    sql`UPDATE talent_search_policy_versions SET status = 'superseded' WHERE id = ${current.id}`,
    sql`UPDATE talent_search_policy_versions SET
          status = 'active', applied_at = now(),
          change_reason = ${changeReason}, created_by = ${actorAccountId}
        WHERE id = ${draft.id}
        RETURNING *`,
    // saveDraftOverrides는 초안이 있으면 UPDATE, 없으면 INSERT하는
    // check-then-act라 DB 유니크 제약이 없다 -- 동시에 첫 저장이 두 번
    // 들어오는 극히 드문 경우엔 초안 행이 두 개 생길 수 있다. 그 상태에서
    // 방금 승격한 것 말고 다른 draft 행이 남아있으면 영구히 고아 초안으로
    // 남아 배너가 계속 뜨고, 다음 카드 저장이 그 고아 행에 병합돼버린다.
    // 정상 케이스(초안이 늘 하나뿐)에서는 대상이 없어 아무 효과가 없는
    // 순수 보험용 삭제문이다.
    sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft' AND id <> ${draft.id}`
  ]);
  return result[1][0];
}

export async function discardDraft() {
  await sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`;
}

// 특정 버전(과거든 활성이든)의 값을 그대로 복구해 새 초안으로 만든다. 이미
// 초안이 있었다면 통째로 덮어쓴다(saveDraftOverrides처럼 이어서 병합하는 게
// 아니라, "이 시점 스냅샷으로 완전히 교체"가 목적이라서다 -- 사용자가
// 명시적으로 확인한 동작). DELETE와 INSERT를 applyDraft와 같은 방식으로
// sql.transaction 하나로 묶어서, INSERT가 실패해도 기존 초안이 대체 없이
// 사라지는 데이터손실 창을 없앤다 -- insertNewDraft는 그 자체로 별도
// SELECT MAX(version_no) 라운드트립을 하므로 트랜잭션 안에서 재사용하지
// 않고, 다음 버전 번호를 서브쿼리로 같은 트랜잭션 안에서 계산한다.
export async function restoreVersionAsDraft(versionId, actorAccountId) {
  const [target] = await sql`SELECT * FROM talent_search_policy_versions WHERE id = ${versionId}`;
  if (!target) throw new Error('복구할 버전을 찾을 수 없어요');

  const result = await sql.transaction([
    sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`,
    sql`INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, created_by
    ) VALUES (
      (SELECT COALESCE(MAX(version_no), 0) + 1 FROM talent_search_policy_versions),
      ${JSON.stringify(target.level1_rules)}::jsonb,
      ${JSON.stringify(target.common_fit_weights)}::jsonb, ${JSON.stringify(target.evidence_coefficients)}::jsonb,
      ${JSON.stringify(target.job_fit_default_weights)}::jsonb, ${JSON.stringify(target.rounding_rule)}::jsonb,
      ${JSON.stringify(target.thresholds)}::jsonb, ${JSON.stringify(target.sort_tiebreak_rules)}::jsonb,
      ${target.daily_recommend_cap_default}, ${target.daily_recommend_cap_absolute_max},
      ${target.data_retention_months}, 'draft', ${actorAccountId}
    ) RETURNING *`
  ]);
  return result[1][0];
}

// 최근 limit개 버전(초안 제외)을 변경자 이름과 함께 최신순으로 조회한다.
// 이름 조인은 handlers/audit-log/index.js가 이미 쓰는 accounts->members
// 패턴과 동일 -- accounts에는 이름이 없고 members에 있어서 두 단계로 탄다.
export async function listPolicyVersions(limit) {
  const rows = await sql`
    SELECT v.*, m.name AS created_by_name
    FROM talent_search_policy_versions v
    LEFT JOIN accounts a ON a.id = v.created_by
    LEFT JOIN members m ON m.id = a.employee_id
    WHERE v.status != 'draft'
    ORDER BY v.version_no DESC
    LIMIT ${limit}`;
  return rows;
}

// validate(body): body(= req.body 그대로, 더 이상 changeReason을 따로 빼지
// 않는다 -- 5개 카드 요청에 이제 changeReason이 없다)를 검사해 에러 메시지
// 문자열 또는 null 반환. buildOverrides(body): body를 saveDraftOverrides에
// 넘길 snake_case 필드 객체로 변환.
export function makePolicyPatchHandler({ validate, buildOverrides }) {
  return async function handler(req, res) {
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const account = await requireTalentSearchAccess(req, res);
    if (!account) return;

    const body = req.body || {};
    const validationError = validate(body);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const updated = await saveDraftOverrides(buildOverrides(body), account.id);
      return res.status(200).json(policy_out(updated));
    } catch (err) {
      // saveDraftOverrides가 "적용 중인 기준이 없어요"를 던지는 경우는 활성
      // 정책 자체가 없는 (사실상 불가능한) 상태라, 기존 factory가 지키던
      // 404 의미를 그대로 보존한다 -- 그 외 예외는 전부 일반 500.
      if (err.message === '적용 중인 기준이 없어요') return res.status(404).json({ error: err.message });
      console.error(err);
      return res.status(500).json({ error: '기준 수정에 실패했어요' });
    }
  };
}
