/**
 * POST { platform, candidates: [{maskedName,gender?,age?,careerSummary?,
 *        recentPositions?,education?,tags?,badges?,lastUpdatedLabel?,
 *        sourceUrl}] } -> 201 { imported: N }
 *   크롬 확장 전용(requireExtensionToken). 사람인 검색리스트 화면에서
 *   "가져오기"를 누르면 호출된다. 채점을 하지 않으므로 원본 필드
 *   그대로 저장만 한다(이 프로젝트의 "서버는 원본만" 원칙).
 *
 * GET -> 200 { candidates: [...] }  (최신순)
 *   HR 사이트 "검색 진행" 화면 전용(requireTalentSearchAccess).
 */
import { sql } from '../../_lib/db.js';
import { requireExtensionToken, requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { validateListCandidateBatch } from '../../_lib/talentSearchListCandidateValidate.js';

function candidate_out(row) {
  return {
    id: row.id,
    platform: row.platform,
    maskedName: row.masked_name,
    gender: row.gender,
    age: row.age,
    careerSummary: row.career_summary,
    recentPositions: row.recent_positions,
    education: row.education,
    tags: row.tags,
    badges: row.badges,
    lastUpdatedLabel: row.last_updated_label,
    sourceUrl: row.source_url,
    importedAt: row.created_at
  };
}

export default async function handler(req, res) {
  const { id: projectId } = req.query;

  if (req.method === 'POST') {
    const account = await requireExtensionToken(req, res);
    if (!account) return;

    const body = req.body || {};
    const validationError = validateListCandidateBatch(body);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const [project] = await sql`SELECT id FROM talent_search_projects WHERE id = ${projectId}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });

      const statements = body.candidates.map(c => sql`
        INSERT INTO talent_search_list_candidates (
          project_id, platform, masked_name, gender, age, career_summary,
          recent_positions, education, tags, badges, last_updated_label,
          source_url, imported_by_account_id
        ) VALUES (
          ${projectId}, ${body.platform}, ${c.maskedName}, ${c.gender || null}, ${c.age ?? null},
          ${c.careerSummary || null}, ${JSON.stringify(c.recentPositions || [])}::jsonb,
          ${c.education || null}, ${JSON.stringify(c.tags || [])}::jsonb,
          ${JSON.stringify(c.badges || [])}::jsonb, ${c.lastUpdatedLabel || null},
          ${c.sourceUrl}, ${account.id}
        )`);
      await sql.transaction(statements);

      return res.status(201).json({ imported: body.candidates.length });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '후보 리스트를 저장하지 못했어요' });
    }
  }

  if (req.method === 'GET') {
    const account = await requireTalentSearchAccess(req, res);
    if (!account) return;

    try {
      const rows = await sql`
        SELECT * FROM talent_search_list_candidates
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC`;
      return res.status(200).json({ candidates: rows.map(candidate_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '후보 리스트를 불러오지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
