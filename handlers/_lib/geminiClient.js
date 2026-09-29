/**
 * Gemini(무료 등급)로 실제 후보 텍스트를 읽고 "이 사람이 우리 조건에
 * 진짜 맞는지" 판단한다. 2026-09-04 사용자 확인: 무료 등급이라 구글이
 * 이 내용을 모델 개선에 쓸 수 있다는 걸 인지하고, 그래도 실제 데이터로
 * 진행하기로 결정함(대안: 유료 전환 -- 이번엔 무료 유지 선택).
 *
 * 기존 scoreListCandidateJobFit(index.html)은 태그·경력요약에 키워드가
 * 몇 개나 그대로 들어있는지 세는 문자열 매칭이라 "약함"이어도 실제
 * 이력서엔 관련 경험이 있을 수 있다 -- 이 함수는 그 대신 실제로 후보의
 * 태그/경력요약/최근경력 메모 전체를 프롬프트에 넣어 판단하게 한다.
 */
import { GoogleGenAI } from '@google/genai';
import { TALENT_SEARCH_REGIONS } from './talentSearchRegions.js';
import { TALENT_SEARCH_EDUCATION_LEVELS } from './talentSearchProjectValidate.js';

// 2026-09-29: 모델 이름을 Vercel 환경변수 GEMINI_MODEL로 덮어쓸 수 있게
// 했다. 2026-09-28 실사이트에서 "AI의견"이 502를 냈는데(원인 로그 미확인
// -- Vercel Logs의 "Gemini 평가 실패" 줄에서 확인할 것), 모델 이름이
// 만료된 경우라면 코드 배포 없이 환경변수만 바꿔 복구할 수 있게 하려는 것.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// 무료 등급 Gemini는 "모델 과부하(503)"를 꽤 자주 돌려준다 -- 잠깐 뒤에
// 다시 부르면 대부분 성공하는 일시적 오류라, 사용자에게 바로 실패를
// 보여주기 전에 짧게 두 번까지 다시 시도한다. 429(한도 초과)는 기다려도
// 곧바로 풀리지 않는 경우가 많아 재시도하지 않는다(한도를 더 소모함).
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [800, 2000];

async function generateJson(contents, responseSchema) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { responseMimeType: 'application/json', responseSchema }
      });
      return JSON.parse(response.text);
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length && RETRYABLE_STATUS.has(err && err.status)) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Gemini 호출 실패를 사용자에게 보여줄 한국어 문장으로 바꾼다. 전에는
 * 모든 실패가 "AI 판단을 받아오지 못했어요" 하나로 뭉뚱그려져서, 화면만
 * 봐서는 키 문제인지 한도 문제인지 알 수 없었다(2026-09-28 502). 에러
 * 원문(키 값은 들어있지 않음)은 console.error로 Vercel 로그에 남긴다.
 */
export function describeGeminiError(err) {
  const status = err && err.status;
  const msg = String((err && err.message) || '');
  if (!process.env.GEMINI_API_KEY) return 'AI 연결 설정(GEMINI_API_KEY)이 서버에 없어요 - 관리자에게 알려주세요';
  if (status === 429) return 'AI 무료 사용 한도를 넘었어요 - 잠시 뒤(길면 내일) 다시 시도해주세요';
  if (status === 404 || /not found|is not supported/i.test(msg)) return `AI 모델(${MODEL})을 찾을 수 없어요 - 모델 이름 변경이 필요해요(관리자 확인)`;
  if (status === 400 && /api key/i.test(msg)) return 'AI 연결 키(GEMINI_API_KEY)가 올바르지 않아요 - 관리자에게 알려주세요';
  if (status === 401 || status === 403) return 'AI 연결 키 권한에 문제가 있어요 - 관리자에게 알려주세요';
  if (RETRYABLE_STATUS.has(status)) return 'AI 서버가 지금 혼잡해요 - 잠시 후 다시 시도해주세요';
  if (err instanceof SyntaxError) return 'AI가 알아볼 수 없는 답을 보냈어요 - 다시 시도해주세요';
  return 'AI 응답을 받아오지 못했어요 - 잠시 후 다시 시도해주세요';
}

function buildPrompt(candidate, project) {
  const keywords = project.keywords || {};
  const requirementLines = [
    keywords.include?.length ? `필수 키워드: ${keywords.include.join(', ')}` : null,
    keywords.or?.length ? `이 중 하나 이상: ${keywords.or.join(', ')}` : null,
    keywords.exact?.length ? `정확히 일치해야 함: ${keywords.exact.join(', ')}` : null,
    keywords.preferred?.length ? `우대: ${keywords.preferred.join(', ')}` : null,
    keywords.exclude?.length ? `이 조건이면 제외: ${keywords.exclude.join(', ')}` : null,
    project.experienceMinYears != null || project.experienceMaxYears != null
      ? `희망 경력: ${project.experienceMinYears ?? '?'}~${project.experienceMaxYears ?? '?'}년` : null
  ].filter(Boolean).join('\n');

  const recentPositions = (candidate.recentPositions || [])
    .map(p => `- ${p.company || ''} ${p.period || ''}: ${p.note || ''}`.trim())
    .join('\n');

  return `너는 채용 담당자를 돕는 보조 역할이다. 아래 채용 조건과 후보자 정보를 보고, 이 후보가 조건에 실제로 잘 맞는지 판단해라.

[채용 조건]
${requirementLines || '(등록된 조건 없음)'}

[후보자 정보]
태그: ${(candidate.tags || []).join(', ') || '(없음)'}
경력요약: ${candidate.careerSummary || '(없음)'}
학력: ${candidate.education || '(없음)'}
${candidate.lastSalaryLabel ? `${candidate.lastSalaryLabel} (마지막 회사에서 받은 연봉, 본인이 공개한 경우에만 있음)\n` : ''}최근 경력:
${recentPositions || '(없음)'}

키워드가 문자 그대로 안 보여도, 문맥상 실제로 관련 경험이 있으면 그걸 근거로 삼아라. 정보가 부족해서 판단이 애매하면 "확인 필요"로 답해라. 직전연봉 정보가 있으면 참고로 근거에 짧게 언급해라 -- 단, 우리 회사가 이 자리에 제시할 연봉 정보는 너한테 없으니 "적합/부적합"을 연봉으로 판단하지는 말고 사실만 전달해라.`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['추천', '확인 필요', '제외'] },
    reasoning: { type: 'string' }
  },
  required: ['verdict', 'reasoning']
};

export async function evaluateCandidateFit(candidate, project) {
  const parsed = await generateJson(buildPrompt(candidate, project), RESPONSE_SCHEMA);
  return { verdict: parsed.verdict, reasoning: parsed.reasoning };
}

/* ---------- "새 인재검색" 문장 → 검색 조건 (2026-09-29) ----------
 * 인사팀이 적은 채용 조건 문장 하나를 화면의 칩(꼭 있어야 해요 / 있으면
 * 좋아요 / 있으면 안 돼요)과 지역·경력 선택값으로 정리한다. 보내는 건
 * 회사의 채용 조건 문장뿐이고 후보자 개인정보는 없다. 응답은
 * talentSearchBriefSanitize.js가 한 번 더 걸러낸다(여기선 모양만 강제).
 */
const CHIP_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { label: { type: 'string' }, synonyms: { type: 'array', items: { type: 'string' } } },
    required: ['label', 'synonyms']
  }
};

const BRIEF_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    roleTitle: { type: 'string' },
    region: { type: 'string', nullable: true },
    districts: { type: 'array', items: { type: 'string' } },
    experienceMinYears: { type: 'number', nullable: true },
    experienceMaxYears: { type: 'number', nullable: true },
    must: CHIP_SCHEMA,
    nice: CHIP_SCHEMA,
    avoidKeywords: { type: 'array', items: { type: 'string' } },
    avoidConditions: { type: 'array', items: { type: 'string' } },
    exact: { type: 'array', items: { type: 'string' } },
    educationLevels: { type: 'array', items: { type: 'string' } },
    spans: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, type: { type: 'string', enum: ['지역', '경력', '직무', '필수', '우대', '제외'] } },
        required: ['text', 'type']
      }
    }
  },
  required: ['roleTitle', 'region', 'districts', 'experienceMinYears', 'experienceMaxYears', 'must', 'nice',
             'avoidKeywords', 'avoidConditions', 'exact', 'educationLevels', 'spans']
};

function buildBriefPrompt(brief) {
  const regionLines = Object.entries(TALENT_SEARCH_REGIONS)
    .map(([region, districts]) => `- ${region}: ${districts.join(', ') || '(구/군 없음)'}`)
    .join('\n');
  return `너는 채용 담당자가 쓴 "어떤 사람을 찾는지" 문장을 채용 사이트(사람인) 검색 조건으로 정리하는 보조 역할이다.

[가장 중요한 규칙]
- 문장에 적혀 있지 않은 조건은 절대 지어내지 마라. 없으면 빈 값(빈 문자열, 빈 배열, null)으로 둬라.
- 각 항목은 짧은 명사구로 써라(예: "촬영", "After Effects", "커머스").

[항목 설명]
- roleTitle: 찾는 직무 이름(예: "영상PD"). 없으면 "".
- region: 아래 목록의 시/도 이름 중 하나. 문장에 지역이 없으면 null.
- districts: region에 속한 구/군 중 문장에 나온 것만, 아래 목록의 표기 그대로. 시/도 전체면 ["전체"].
- experienceMinYears / experienceMaxYears: 경력 연수(숫자). "신입"이면 최소 0. 없으면 null.
- must: 반드시 있어야 하는 역량·경험. synonyms에는 이력서에서 같은 뜻으로 흔히 쓰는 다른 표현을 0~5개(한글/영문 약어 포함).
- nice: 있으면 좋은(우대) 역량·경험. synonyms 규칙은 must와 같다.
- avoidKeywords: 이력서에 이 단어가 있으면 제외해야 하는 단어(예: "보험영업"). 검색에서 빼는 용도라 한 단어짜리만.
- avoidConditions: 단어가 아니라 이력을 봐야 판단 가능한 제외 조건(예: "최근 6개월 이상 경력 공백", "잦은 이직").
- exact: 문장이 "정확히 이 표현"이라고 명시한 경우만. 대부분 빈 배열.
- educationLevels: 문장에 학력 조건이 있을 때만, 다음 값 중에서: ${TALENT_SEARCH_EDUCATION_LEVELS.join(', ')}. "대졸 이상"이면 대학(4년), 석사, 박사처럼 해당하는 값을 모두.
- spans: 원문에서 각 조건을 읽어낸 부분을 원문 글자 그대로 복사(한 글자도 바꾸지 말 것). type은 지역/경력/직무/필수/우대/제외 중 하나.

[사람인 시/도와 구/군 목록]
${regionLines}

[문장]
${brief}`;
}

export async function parseTalentSearchBrief(brief) {
  return generateJson(buildBriefPrompt(brief), BRIEF_RESPONSE_SCHEMA);
}
