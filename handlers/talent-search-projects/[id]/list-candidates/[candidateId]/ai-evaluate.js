/**
 * handlers/talent-search-projects/[id]/list-candidates/[candidateId]/ai-evaluate.js
 *
 * POST -> 200 { id, aiVerdict, aiReasoning, aiEvaluatedAt } | 404 | 502
 *
 * 2026-09-04 추가: 기존 scoreListCandidateJobFit(index.html)은 태그·
 * 경력요약에 프로젝트 키워드가 문자 그대로 몇 개나 들어있는지 세는
 * 근사치라서, 실제로는 관련 경험이 있어도 단어가 안 겹치면 "근거
 * 약함"으로 나온다는 피드백을 받았다(2026-09-04 대화 참고). 이 엔드
 * 포인트는 후보의 실제 텍스트(태그/경력요약/학력/최근경력 메모)를
 * Gemini(무료 등급)에 보내 실제로 읽고 판단하게 한다 -- 판단 자체를
 * 저장한다(실행할 때마다 다시 계산하는 클라이언트 계산값들과 달리,
 * 이건 실제 API 호출 비용이 들어서 매 렌더마다 다시 부르지 않는다).
 *
 * 2026-09-04 사용자 확인: Gemini 무료 등급은 제출한 내용을 구글이
 * 모델 개선에 쓸 수 있고 이걸 막을 방법이 없다(유료 전환만 가능) --
 * 이 사실을 안내한 뒤 그래도 무료 등급으로 실제 후보 데이터를 쓰기로
 * 사용자가 직접 결정함. 별도로, 후보자 개인정보를 해외 제3자(구글)
 * AI로 처리하는 것 자체가 채용 동의서에 포함돼 있는지는 이 기능과
 * 별개로 인사팀 확인이 필요하다고 안내함(코드 변경 대상 아님).
 */
import { sql } from '../../../../_lib/db.js';
import { requireTalentSearchAccess } from '../../../../_lib/accountAuth.js';
import { evaluateCandidateFit } from '../../../../_lib/geminiClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id, candidateId } = req.query;

  try {
    const [project] = await sql`
      SELECT keywords, experience_min_years, experience_max_years
      FROM talent_search_projects WHERE id = ${id}`;
    if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });

    const [candidate] = await sql`
      SELECT tags, career_summary, education, recent_positions
      FROM talent_search_list_candidates WHERE id = ${candidateId} AND project_id = ${id}`;
    if (!candidate) return res.status(404).json({ error: '후보를 찾을 수 없어요' });

    const projectForCall = {
      keywords: project.keywords,
      experienceMinYears: project.experience_min_years === null ? null : Number(project.experience_min_years),
      experienceMaxYears: project.experience_max_years === null ? null : Number(project.experience_max_years)
    };
    const candidateForCall = {
      tags: candidate.tags,
      careerSummary: candidate.career_summary,
      education: candidate.education,
      recentPositions: candidate.recent_positions
    };

    let result;
    try {
      result = await evaluateCandidateFit(candidateForCall, projectForCall);
    } catch (err) {
      console.error('Gemini 평가 실패', err);
      return res.status(502).json({ error: 'AI 판단을 받아오지 못했어요 - 잠시 후 다시 시도해주세요' });
    }

    const [row] = await sql`
      UPDATE talent_search_list_candidates
      SET ai_verdict = ${result.verdict}, ai_reasoning = ${result.reasoning}, ai_evaluated_at = now()
      WHERE id = ${candidateId} AND project_id = ${id}
      RETURNING id, ai_verdict, ai_reasoning, ai_evaluated_at`;

    return res.status(200).json({
      id: row.id,
      aiVerdict: row.ai_verdict,
      aiReasoning: row.ai_reasoning,
      aiEvaluatedAt: row.ai_evaluated_at
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'AI 판단을 저장하지 못했어요' });
  }
}
