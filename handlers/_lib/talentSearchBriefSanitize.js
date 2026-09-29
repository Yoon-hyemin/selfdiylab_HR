/**
 * handlers/_lib/talentSearchBriefSanitize.js
 *
 * "새 인재검색" 문장 → 조건 정리(POST /api/talent-search-projects/parse-brief)
 * 에서 Gemini가 돌려준 JSON을 화면에 넘기기 전에 한 번 더 걸러낸다.
 * responseSchema로 모양은 강제되지만 값까지 믿을 수는 없어서다:
 *   - 구 이름·학력은 사람인이 실제로 쓰는 값만 남긴다(확장이 이 값으로
 *     체크박스를 정확히 일치 비교하므로 오타 하나면 조용히 매칭 실패).
 *   - spans[].text는 원문에 그대로 있는 부분 문자열만 남긴다(하이라이트
 *     위치를 원문에서 찾기 때문).
 *   - 빈 값·중복·지나치게 긴 값은 버린다. 모든 항목이 비어도 정상이다
 *     (문장에 없는 걸 지어내지 않게 하는 게 우선).
 *
 * DB를 import하지 않는다 -- DATABASE_URL 없이 node --test로 돈다.
 */
import { TALENT_SEARCH_REGIONS, normalizeRegion, regionAllLabel } from './talentSearchRegions.js';
import { TALENT_SEARCH_EDUCATION_LEVELS } from './talentSearchProjectValidate.js';

export const BRIEF_SPAN_TYPES = ['지역', '경력', '직무', '필수', '우대', '제외'];

const MAX_LABEL_LEN = 40;
const MAX_ITEMS = 15;
const MAX_SYNONYMS = 10;

function cleanString(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > MAX_LABEL_LEN ? '' : t;
}

function cleanStringList(list, exclude = new Set()) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set(exclude);
  for (const v of list) {
    const t = cleanString(v);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function cleanYears(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 50) return null;
  return n;
}

function cleanChips(list, usedLabels) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const label = cleanString(item && item.label);
    if (!label || usedLabels.has(label)) continue;
    usedLabels.add(label);
    const synonyms = cleanStringList(item.synonyms, new Set([label])).slice(0, MAX_SYNONYMS);
    out.push({ label, synonyms });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function sanitizeParsedBrief(raw, brief) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const text = typeof brief === 'string' ? brief : '';

  const region = normalizeRegion(r.region);
  let districts = [];
  if (region) {
    const allowed = TALENT_SEARCH_REGIONS[region];
    const allLabel = regionAllLabel(region);
    const wanted = cleanStringList(r.districts);
    if (wanted.some(d => d === '전체' || d === allLabel)) {
      districts = [allLabel];
    } else {
      districts = wanted.filter(d => allowed.includes(d));
    }
  }

  let experienceMinYears = cleanYears(r.experienceMinYears);
  let experienceMaxYears = cleanYears(r.experienceMaxYears);
  if (experienceMinYears !== null && experienceMaxYears !== null && experienceMaxYears < experienceMinYears) {
    experienceMaxYears = null;
  }

  const usedLabels = new Set();
  const must = cleanChips(r.must, usedLabels);
  const nice = cleanChips(r.nice, usedLabels);
  const avoidKeywords = cleanStringList(r.avoidKeywords, usedLabels);
  avoidKeywords.forEach(k => usedLabels.add(k));
  const avoidConditions = cleanStringList(r.avoidConditions, usedLabels);
  const exact = cleanStringList(r.exact);

  const educationLevels = Array.isArray(r.educationLevels)
    ? TALENT_SEARCH_EDUCATION_LEVELS.filter(lv => r.educationLevels.includes(lv))
    : [];

  const spans = Array.isArray(r.spans)
    ? r.spans.filter(s => s && typeof s.text === 'string' && s.text.trim() && BRIEF_SPAN_TYPES.includes(s.type) && text.includes(s.text))
        .map(s => ({ text: s.text, type: s.type }))
    : [];

  return {
    roleTitle: cleanString(r.roleTitle),
    region,
    districts,
    experienceMinYears,
    experienceMaxYears,
    must,
    nice,
    avoidKeywords,
    avoidConditions,
    exact,
    educationLevels,
    spans
  };
}
