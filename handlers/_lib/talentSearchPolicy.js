/**
 * handlers/_lib/talentSearchPolicy.js
 *
 * 인재검색 채점 정책(talent_search_policy_versions) 공용 헬퍼. 1B-2~1B-3까지는
 * "수정 = 새 버전을 만들어 즉시 활성화"(createPolicyVersion)였는데, 1B-4a부터는
 * 저장과 적용을 분리한다 -- 카드 저장은 초안(status='draft')에만 반영되고,
 * 별도의 "적용하기"를 거쳐야 실제 활성 버전이 바뀐다. 초안은 전역에서 한 번에
 * 하나만 존재한다: 이미 초안이 있으면 그 행을 그대로 UPDATE(병합)하고, 없으면
 * 활성 버전을 베이스로 새 초안 행을 만든다.
 */
import { sql } from './db.js';
import { requireTalentSearchAccess } from './accountAuth.js';
import { validateOverrideKeys } from './talentSearchPolicyValidate.js';

export function policy_out(row) {
  return {
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

  const [maxRow] = await sql`SELECT MAX(version_no) AS max FROM talent_search_policy_versions`;
  const nextVersionNo = (maxRow.max || 0) + 1;
  const [inserted] = await sql`
    INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, created_by
    ) VALUES (
      ${nextVersionNo}, ${JSON.stringify(next.level1_rules)}::jsonb,
      ${JSON.stringify(next.common_fit_weights)}::jsonb, ${JSON.stringify(next.evidence_coefficients)}::jsonb,
      ${JSON.stringify(next.job_fit_default_weights)}::jsonb, ${JSON.stringify(next.rounding_rule)}::jsonb,
      ${JSON.stringify(next.thresholds)}::jsonb, ${JSON.stringify(next.sort_tiebreak_rules)}::jsonb,
      ${next.daily_recommend_cap_default}, ${next.daily_recommend_cap_absolute_max},
      ${next.data_retention_months}, 'draft', ${actorAccountId}
    ) RETURNING *`;
  return inserted;
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
        RETURNING *`
  ]);
  return result[1][0];
}

export async function discardDraft() {
  await sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`;
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
