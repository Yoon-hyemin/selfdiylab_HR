/**
 * handlers/talent-search-job-templates/index.js
 *
 * GET  -> 200 { templates: [{ id, name, criteria, createdAt }] } (최신순 전체)
 * POST { name, criteria } -> 201 { id }
 *
 * Phase 1C: "직무 템플릿 저장/불러오기". criteria는 검색 프로젝트 입력
 * 폼의 조건 필드(프로젝트명 제외) 스냅샷을 프론트가 그대로 담아 보낸 것
 * -- 서버는 구조를 깊게 검증하지 않고 object인지만 확인한다(기준
 * 관리센터의 정책 jsonb와 같은 신뢰 모델). 인재검색 접근권한이 있는
 * 사람 전체가 공유해서 본다(만든 사람과 무관 -- 내부 소규모 팀 공용
 * 도구, talent_search_policy_versions와 같은 공유 모델).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { validateJobTemplateInput } from '../_lib/talentSearchProjectValidate.js';

function template_out(row) {
  return { id: row.id, name: row.name, criteria: row.criteria, createdAt: row.created_at };
}

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM talent_search_job_templates ORDER BY created_at DESC`;
      return res.status(200).json({ templates: rows.map(template_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '직무 템플릿을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const validationError = validateJobTemplateInput(body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
      const [row] = await sql`
        INSERT INTO talent_search_job_templates (name, criteria, created_by)
        VALUES (${body.name.trim()}, ${JSON.stringify(body.criteria)}::jsonb, ${account.id})
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '직무 템플릿을 저장하지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
