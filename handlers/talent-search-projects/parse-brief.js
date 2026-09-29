/**
 * handlers/talent-search-projects/parse-brief.js
 *
 * POST { brief } -> 200 { roleTitle, region, districts, experienceMinYears,
 *   experienceMaxYears, must:[{label,synonyms}], nice:[...], avoidKeywords,
 *   avoidConditions, exact, educationLevels, spans:[{text,type}] } | 400 | 502
 *
 * 2026-09-29 "새 인재검색 간소화": 입력칸 13개 + 검색엔진 문법(필수/OR/
 * 정확일치/제외/우대)을 직접 나눠 넣는 게 어렵다는 피드백으로, 문장 한
 * 줄을 쓰면 AI(Gemini)가 조건 칩으로 정리해주는 흐름을 만들었다. 이
 * 엔드포인트는 정리만 하고 저장하지 않는다 -- 사용자가 확인 화면에서
 * 칩을 고친 뒤 기존 POST /api/talent-search-projects로 저장한다.
 *
 * 보내는 건 회사의 채용 조건 문장뿐이다(후보자 개인정보 없음, 기존
 * AI의견보다 민감도 낮음). 권한은 인재검색 전체와 동일하게
 * requireTalentSearchAccess(ADMIN 전용 아님).
 *
 * 라우팅 주의: api/[...path].js에서 이 경로는 ['talent-search-projects',
 * ':id'](상세 조회)보다 먼저 등록돼야 한다 -- 순서가 바뀌면
 * "parse-brief"가 프로젝트 id로 해석된다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { parseTalentSearchBrief, describeGeminiError } from '../_lib/geminiClient.js';
import { sanitizeParsedBrief } from '../_lib/talentSearchBriefSanitize.js';

const MAX_BRIEF_LEN = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const brief = typeof req.body?.brief === 'string' ? req.body.brief.trim() : '';
  if (!brief) return res.status(400).json({ error: '어떤 사람을 찾는지 문장을 입력해주세요' });
  if (brief.length > MAX_BRIEF_LEN) return res.status(400).json({ error: `문장이 너무 길어요(${MAX_BRIEF_LEN}자 이하)` });

  let raw;
  try {
    raw = await parseTalentSearchBrief(brief);
  } catch (err) {
    console.error('Gemini 조건 정리 실패', err && err.status, err);
    return res.status(502).json({ error: describeGeminiError(err) });
  }
  return res.status(200).json(sanitizeParsedBrief(raw, brief));
}
