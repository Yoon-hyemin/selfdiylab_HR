/**
 * POST { platform, batchKey?, candidates: [{maskedName,gender?,age?,
 *        careerSummary?,recentPositions?,education?,tags?,badges?,
 *        lastUpdatedLabel?,lastSalaryLabel?,sourceUrl}] } -> 201 { imported: N,
 *        skipped: M, duplicates: D, skippedReasons: { resumeStale, careerOutOfRange } }
 *   크롬 확장 전용(requireExtensionToken). 사람인 검색리스트 화면에서
 *   "가져오기"를 누르면 호출된다. 채점을 하지 않으므로 원본 필드
 *   그대로 저장만 한다(이 프로젝트의 "서버는 원본만" 원칙) -- 단,
 *   2026-08-28부터 저장 전에 evaluateListCandidate(talentSearchListFilter.js)로
 *   명확히 조건 밖인 후보(이력서 업데이트 180일 초과 또는 프로젝트
 *   희망 경력범위 밖)는 아예 저장하지 않는다. 판단 불가는 통과시킨다.
 *   판정 기준은 이 프로젝트가 승인 시점에 고정해 둔 정책 버전
 *   (policy_version_id)을 쓴다 -- 나중에 정책이 바뀌어도 이미 지난
 *   가져오기의 판정 근거가 흔들리지 않게 하기 위해서다(1D-2가 채점
 *   기준을 승인 시점에 고정하는 것과 같은 이유).
 *
 *   2026-09-03 추가: 같은 조건으로 여러 번 "가져오기"를 실행하면(1차
 *   조회, 2차 조회...) 같은 사람이 계속 다시 저장돼 인원이 섞이는
 *   문제가 실사용에서 발견됐다(development 브랜치에서 91개 그룹 중복
 *   확인). sourceUrl(사람인 이력서 URL)이 실제 사람을 가리키는 유일한
 *   값이라는 점을 이용해 (project_id, source_url) DB 유니크 제약으로
 *   막는다(sql/025) -- INSERT에 ON CONFLICT DO NOTHING을 걸어서 중복은
 *   조용히 건너뛰고 개수만 센다. batchKey는 "몇 번째 조회인지" 화면에
 *   구분해서 보여주기 위한 값(크롬 확장이 "목표 인원 채우기" 클릭
 *   시점에 한 번 발급해 그 세션의 모든 페이지 POST에 동일하게 실어
 *   보낸다) -- 저장 안 해도 되는 부가정보라 없어도 저장 자체는 막지
 *   않는다.
 *
 * GET -> 200 { candidates: [...] }  (최신순)
 *   HR 사이트 "검색 진행" 화면 전용(requireTalentSearchAccess).
 */
import { sql } from '../../_lib/db.js';
import { requireExtensionToken, requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { validateListCandidateBatch } from '../../_lib/talentSearchListCandidateValidate.js';
import { evaluateListCandidate } from '../../_lib/talentSearchListFilter.js';
import { getPolicyById } from '../../_lib/talentSearchPolicy.js';

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
    lastSalaryLabel: row.last_salary_label,
    sourceUrl: row.source_url,
    importedAt: row.created_at,
    internalReviewStatus: row.internal_review_status,
    internalReviewNote: row.internal_review_note,
    batchKey: row.batch_key,
    aiVerdict: row.ai_verdict,
    aiReasoning: row.ai_reasoning,
    aiEvaluatedAt: row.ai_evaluated_at
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
      const [project] = await sql`
        SELECT id, experience_min_years, experience_max_years, policy_version_id
        FROM talent_search_projects WHERE id = ${projectId}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });

      // policy_version_id가 없으면(승인 전 프로젝트, 정상 흐름에서는
      // 발생하지 않지만 방어적으로 다룸) 이력서 업데이트일 기준은
      // 건너뛴다 -- 기준 버전이 없는데 지금 활성 정책을 억지로 갖다
      //쓰면, 나중에 정책이 바뀌었을 때 "그때 왜 걸렀는지" 설명할 수
      // 없어서다.
      let level1Rules = null;
      if (project.policy_version_id) {
        const policy = await getPolicyById(project.policy_version_id);
        if (policy) level1Rules = policy.level1_rules;
      }

      // Postgres numeric 컬럼은 neon 드라이버가 정밀도 손실을 막으려고
      // 문자열로 내려준다("5") -- evaluateListCandidate는 숫자를
      // 기대하는데, 이 값을 그대로 넘기면 JS의 문자열+숫자 덧셈이
      // 문자열 이어붙이기로 동작해서("5" + 0.5 === "50.5") 최대
      // 경력연수 상한이 사실상 무력화되는 버그가 생긴다(실사용 검증
      // 중 실제로 발견됨 -- 7년 경력자가 1~5년 프로젝트에서 안 걸러짐).
      // 최소 경력연수 쪽은 뺄셈이라 우연히 숫자로 강제변환돼 문제가
      // 안 드러났었다.
      const filterConfig = {
        level1Rules,
        experienceMinYears: project.experience_min_years === null ? null : Number(project.experience_min_years),
        experienceMaxYears: project.experience_max_years === null ? null : Number(project.experience_max_years)
      };
      const now = new Date();

      const kept = [];
      const skippedReasons = { resumeStale: 0, careerOutOfRange: 0 };
      let skipped = 0;
      for (const c of body.candidates) {
        const { skip, reasons } = evaluateListCandidate(c, filterConfig, now);
        if (skip) {
          skipped += 1;
          reasons.forEach(r => { skippedReasons[r] += 1; });
        } else {
          kept.push(c);
        }
      }

      let importedCount = 0;
      if (kept.length) {
        const statements = kept.map(c => sql`
          INSERT INTO talent_search_list_candidates (
            project_id, platform, masked_name, gender, age, career_summary,
            recent_positions, education, tags, badges, last_updated_label,
            last_salary_label, source_url, imported_by_account_id, batch_key
          ) VALUES (
            ${projectId}, ${body.platform}, ${c.maskedName}, ${c.gender || null}, ${c.age ?? null},
            ${c.careerSummary || null}, ${JSON.stringify(c.recentPositions || [])}::jsonb,
            ${c.education || null}, ${JSON.stringify(c.tags || [])}::jsonb,
            ${JSON.stringify(c.badges || [])}::jsonb, ${c.lastUpdatedLabel || null},
            ${c.lastSalaryLabel || null},
            ${c.sourceUrl}, ${account.id}, ${body.batchKey || null}
          )
          ON CONFLICT (project_id, source_url) DO NOTHING
          RETURNING id`);
        const results = await sql.transaction(statements);
        importedCount = results.reduce((sum, rows) => sum + rows.length, 0);
      }
      const duplicates = kept.length - importedCount;

      return res.status(201).json({ imported: importedCount, skipped, duplicates, skippedReasons });
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
