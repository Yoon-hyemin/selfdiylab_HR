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

const MODEL = 'gemini-3.6-flash';

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
최근 경력:
${recentPositions || '(없음)'}

키워드가 문자 그대로 안 보여도, 문맥상 실제로 관련 경험이 있으면 그걸 근거로 삼아라. 정보가 부족해서 판단이 애매하면 "확인 필요"로 답해라.`;
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
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(candidate, project),
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    }
  });
  const parsed = JSON.parse(response.text);
  return { verdict: parsed.verdict, reasoning: parsed.reasoning };
}
