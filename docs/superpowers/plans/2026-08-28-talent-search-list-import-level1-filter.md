# 인재검색 리스트 가져오기 — Level1 자동필터 + 자동 페이지 넘김 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "실제 후보 리스트 가져오기"가 (1) 저장 전에 명확히 조건 밖(이력서 업데이트 180일 초과 또는 경력연수 범위 밖)인 후보를 걸러내고, (2) 목표 인원을 채울 때까지 크롬 확장이 "다음 페이지"를 자동으로 넘기며 반복 수집하게 한다.

**Architecture:** 서버 쪽은 새 순수 함수 모듈(`handlers/_lib/talentSearchListFilter.js`)로 판정 로직을 분리하고, 기존 `POST .../list-candidates` 핸들러가 저장 전에 이걸 호출해 조건 밖 후보를 걸러낸다(판정 기준은 그 프로젝트가 승인 시점에 고정해 둔 정책 버전 + 프로젝트의 희망 경력범위). 확장 쪽은 리스트 페이지 콘텐츠 스크립트에 "다음 페이지 클릭" 메시지 핸들러를 추가하고, 팝업이 목표 인원에 도달하거나 안전 상한/마지막 페이지/인증화면 감지 중 하나에 닿을 때까지 파싱→전송→다음페이지 클릭을 반복한다. 두 축(서버 필터, 확장 페이지 넘김)은 서로 독립적으로 구현·검증 가능하다 — 서버는 curl/fetch로, 확장은 실제 크롬으로 검증한다.

**Tech Stack:** Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`, `node --test`, Manifest V3 크롬 확장(Vanilla JS), jsdom(확장 순수 로직 테스트용, 이미 devDependency로 있음).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-28-talent-search-list-import-level1-filter-design.md` — 범위·판정기준·안전장치는 이 문서 그대로.
- **이번 슬라이스 범위**: 저장 시점 필터(이력서 업데이트일 + 경력연수) + 자동 페이지 넘김까지만. 재직여부 필터, 제외된 후보의 영구 기록(감사로그), 서버 쪽 영구 중복제거(DB 유니크 제약)는 전부 범위 밖 — 어떤 태스크에도 포함하지 않는다.
- **판단 불가는 항상 통과** — 날짜/경력 텍스트를 못 읽으면 제외하지 않는다(원본 명세 4장 원칙). 이건 OCR 쪽의 fail-closed 원칙과는 다른 문제라는 걸 코드 주석에도 남긴다.
- **기존 가상 후보 파이프라인(`talent_search_candidates`, `simulateCandidate` 등)과 정책 편집 화면(기준 관리센터)은 이번 계획의 어떤 태스크에서도 수정하지 않는다.**
- API 응답 필드는 camelCase, DB 컬럼은 snake_case. 이번 계획은 새 엔드포인트를 추가하지 않으므로 `api/[...path].js` 수정 없음.
- 순수 로직(날짜/경력 파싱, 판정, 다음페이지 버튼 탐색)은 `node --test`로 단위테스트. DB/HTTP가 얽힌 서버 통합은 로컬 dev 서버 + curl/fetch로, 확장 쪽은 실제 크롬으로 컨트롤러가 직접 수동 검증한다(서브에이전트는 브라우저 접근 불가).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 반영은 이 계획의 범위 밖.
- 커밋 메시지, 코드 주석은 한국어로 쓴다.

---

### Task 1: 판정 로직 — 순수 함수 (날짜/경력 파싱 + 필터 판정)

**Files:**
- Create: `handlers/_lib/talentSearchListFilter.js`
- Create: `handlers/_lib/talentSearchListFilter.test.js`

**Interfaces:**
- Produces: `handlers/_lib/talentSearchListFilter.js`가 세 함수를 export한다.
  - `parseResumeAgeDays(label, refDate)` — `label`은 `"26-06-10 업데이트"` 같은 문자열(또는 null/undefined), `refDate`는 `Date` 객체. 반환값은 정수(일수) 또는 파싱 실패 시 `null`.
  - `parseCareerYears(text)` — `text`는 `"경력 5년 3개월"` 같은 문자열(또는 null/undefined). 반환값은 숫자(연차, 소수 가능) 또는 파싱 실패 시 `null`.
  - `evaluateListCandidate(candidate, config, refDate)` — `candidate`는 `{lastUpdatedLabel, careerSummary}`를 포함하는 객체, `config`는 `{level1Rules, experienceMinYears, experienceMaxYears}`(`level1Rules`는 `null` 가능, `experienceMinYears`/`experienceMaxYears`는 `null` 가능), `refDate`는 `Date`. 반환값은 `{skip: boolean, reasons: string[]}` — `reasons`는 `'resumeStale'`/`'careerOutOfRange'` 중 해당하는 것만 담는다.
  - Task 2가 이 세 함수를 그대로 가져다 쓴다.

- [ ] **Step 1: `talentSearchListFilter.js` 작성**

```js
// handlers/_lib/talentSearchListFilter.js
/**
 * "실제 후보 리스트 가져오기"(사람인 검색결과 리스트) 저장 전 필터.
 * 리스트 카드에 이미 나오는 정보(이력서 최종업데이트일, 경력연수)만으로
 * 명확히 조건 밖인 후보를 판정한다. db.js를 import하지 않아
 * DATABASE_URL 없이 node --test로 검증 가능(talentSearchPolicyValidate.js가
 * 이미 쓰는 패턴과 동일).
 *
 * 판단 불가(날짜/경력 텍스트를 못 읽음)는 항상 "통과"로 취급한다 --
 * 원본 명세 4장의 "확실하지 않은 사람은 성급히 탈락시키지 말라"는 원칙.
 * 이건 이 프로젝트가 다른 곳(크롬 확장 OCR)에서 쓰는 "실패하면 에러로
 * 드러낸다"는 fail-closed 원칙과는 별개다 -- 여기서는 판단 불가가
 * 에러가 아니라 정상적으로 발생하는 입력이다.
 */

// 경력연수 여유분. 반올림·근속 계산 오차로 흔히 생기는 경계값을
// 무리하게 걸러내지 않기 위한 값 -- 정책 편집 화면의 대상이 아니라
// 구현 디테일이라 상수로만 관리한다(설계문서 참고).
const CAREER_YEARS_GRACE = 0.5;

export function parseResumeAgeDays(label, refDate) {
  if (typeof label !== 'string') return null;
  const match = /(\d{2})-(\d{2})-(\d{2})/.exec(label);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  const parsed = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(parsed)) return null;
  const days = Math.floor((refDate.getTime() - parsed) / 86400000);
  return days < 0 ? 0 : days;
}

export function parseCareerYears(text) {
  if (typeof text !== 'string') return null;
  if (text.includes('신입')) return 0;
  const yearMatch = /(\d+)\s*년/.exec(text);
  const monthMatch = /(\d+)\s*개월/.exec(text);
  if (!yearMatch && !monthMatch) return null;
  const years = yearMatch ? Number(yearMatch[1]) : 0;
  const months = monthMatch ? Number(monthMatch[1]) : 0;
  return years + months / 12;
}

export function evaluateListCandidate(candidate, config, refDate) {
  const reasons = [];

  const resumeAgeDays = parseResumeAgeDays(candidate.lastUpdatedLabel, refDate);
  if (resumeAgeDays !== null && config.level1Rules
      && resumeAgeDays > config.level1Rules.resumeUpdated.verifyWithinDays) {
    reasons.push('resumeStale');
  }

  const careerYears = parseCareerYears(candidate.careerSummary);
  if (careerYears !== null) {
    const { experienceMinYears, experienceMaxYears } = config;
    if (experienceMinYears != null && careerYears < experienceMinYears - CAREER_YEARS_GRACE) {
      reasons.push('careerOutOfRange');
    } else if (experienceMaxYears != null && careerYears > experienceMaxYears + CAREER_YEARS_GRACE) {
      reasons.push('careerOutOfRange');
    }
  }

  return { skip: reasons.length > 0, reasons };
}
```

- [ ] **Step 2: 테스트 작성**

```js
// handlers/_lib/talentSearchListFilter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeAgeDays, parseCareerYears, evaluateListCandidate } from './talentSearchListFilter.js';

const LABEL = '26-06-10 업데이트';
const PARSED_MS = Date.UTC(2026, 5, 10); // 2026-06-10 UTC

test('parseResumeAgeDays: 정확히 180일 후', () => {
  assert.equal(parseResumeAgeDays(LABEL, new Date(PARSED_MS + 180 * 86400000)), 180);
});

test('parseResumeAgeDays: 181일 후', () => {
  assert.equal(parseResumeAgeDays(LABEL, new Date(PARSED_MS + 181 * 86400000)), 181);
});

test('parseResumeAgeDays: 형식이 안 맞으면 null', () => {
  assert.equal(parseResumeAgeDays('3일 전', new Date()), null);
  assert.equal(parseResumeAgeDays(null, new Date()), null);
  assert.equal(parseResumeAgeDays(undefined, new Date()), null);
});

test('parseResumeAgeDays: 미래 날짜는 0으로 clamp', () => {
  assert.equal(parseResumeAgeDays(LABEL, new Date(PARSED_MS - 86400000)), 0);
});

test('parseCareerYears: "경력 5년 3개월"', () => {
  assert.equal(parseCareerYears('경력 5년 3개월'), 5 + 3 / 12);
});

test('parseCareerYears: "신입"은 0년', () => {
  assert.equal(parseCareerYears('신입'), 0);
});

test('parseCareerYears: 개월만 있는 경우', () => {
  assert.equal(parseCareerYears('경력 8개월'), 8 / 12);
});

test('parseCareerYears: 형식이 안 맞으면 null', () => {
  assert.equal(parseCareerYears('경력무관'), null);
  assert.equal(parseCareerYears(null), null);
});

test('evaluateListCandidate: 둘 다 통과', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 5년' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 3, experienceMaxYears: 7 };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});

test('evaluateListCandidate: 이력서 업데이트만 걸림', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 5년' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 3, experienceMaxYears: 7 };
  const refDate = new Date(PARSED_MS + 181 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: true, reasons: ['resumeStale'] });
});

test('evaluateListCandidate: 경력연수만 걸림 (최소 미달, 여유분 밖)', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 4년 4개월' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: true, reasons: ['careerOutOfRange'] });
});

test('evaluateListCandidate: 경력연수가 여유분 안이면 통과', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 4년 7개월' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});

test('evaluateListCandidate: 둘 다 걸림', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '신입' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 200 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: true, reasons: ['resumeStale', 'careerOutOfRange'] });
});

test('evaluateListCandidate: 판단 불가는 통과', () => {
  const candidate = { lastUpdatedLabel: null, careerSummary: null };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: 10 };
  assert.deepEqual(evaluateListCandidate(candidate, config, new Date()), { skip: false, reasons: [] });
});

test('evaluateListCandidate: level1Rules가 null이면 이력서 기준은 건너뜀', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 5년' };
  const config = { level1Rules: null, experienceMinYears: null, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 300 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});

test('evaluateListCandidate: 프로젝트가 min/max 둘 다 null이면 경력 기준 자체를 안 씀', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '신입' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: null, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `node --test handlers/_lib/talentSearchListFilter.test.js`
Expected: 14개 테스트 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add handlers/_lib/talentSearchListFilter.js handlers/_lib/talentSearchListFilter.test.js
git commit -m "$(cat <<'EOF'
feat: 인재검색 리스트 후보 저장전 필터 순수함수 추가

이력서 업데이트일(Level1 정책 재사용)·경력연수(프로젝트 희망범위)로
명확히 조건 밖인 후보를 판정. 판단 불가는 항상 통과시킨다.
EOF
)"
```

---

### Task 2: 저장 API에 필터 통합 (`POST .../list-candidates`)

**Files:**
- Modify: `handlers/_lib/talentSearchPolicy.js`
- Modify: `handlers/talent-search-projects/[id]/list-candidates.js`

**Interfaces:**
- Consumes: `parseResumeAgeDays`/`parseCareerYears`/`evaluateListCandidate`(Task 1).
- Produces: `handlers/_lib/talentSearchPolicy.js`에 `export async function getPolicyById(id)` 추가(주어진 id의 정책 버전 row를 snake_case 그대로 반환, 없으면 `null`) — 이번 태스크가 그대로 쓰지만 다른 곳에서도 재사용 가능한 일반 헬퍼. `POST /api/talent-search-projects/:id/list-candidates`의 응답이 `201 { imported, skipped, skippedReasons: { resumeStale, careerOutOfRange } }`로 바뀐다(기존 `{ imported }`에서 필드 추가) — Task 4(팝업)가 이 응답 모양을 그대로 소비한다.

- [ ] **Step 1: `getPolicyById` 추가**

`handlers/_lib/talentSearchPolicy.js`의 `getActivePolicy` 함수 바로 뒤에 추가:

```js
export async function getPolicyById(id) {
  const [row] = await sql`SELECT * FROM talent_search_policy_versions WHERE id = ${id}`;
  return row || null;
}
```

- [ ] **Step 2: `list-candidates.js` POST 핸들러에 필터 통합**

`handlers/talent-search-projects/[id]/list-candidates.js` 전체를 아래로 교체:

```js
/**
 * POST { platform, candidates: [{maskedName,gender?,age?,careerSummary?,
 *        recentPositions?,education?,tags?,badges?,lastUpdatedLabel?,
 *        sourceUrl}] } -> 201 { imported: N, skipped: M, skippedReasons: {
 *        resumeStale, careerOutOfRange } }
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

      const filterConfig = {
        level1Rules,
        experienceMinYears: project.experience_min_years,
        experienceMaxYears: project.experience_max_years
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

      if (kept.length) {
        const statements = kept.map(c => sql`
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
      }

      return res.status(201).json({ imported: kept.length, skipped, skippedReasons });
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
```

- [ ] **Step 3: 로컬 dev 서버로 수동 검증**

1. `.env.local`이 `development` 브랜치를 가리키는지 확인, `node scripts/dev-server.js` 실행(또는 재사용)
2. `preview-test@selfdiylab.invalid`/`Preview1234`로 로그인된 브라우저에서 실제 존재하는 **승인된**(`status='approved'`) 검색 프로젝트 id를 하나 확인(`SELECT id, experience_min_years, experience_max_years, policy_version_id, status FROM talent_search_projects WHERE status='approved' LIMIT 1;` — `node scripts/run-sql.js`로 임시 조회 스크립트를 만들거나 dev 서버 콘솔에서 확인). `experience_min_years`가 설정된 프로젝트가 없으면, 검증용으로 하나 만들어서 승인해도 된다(검증 후 정리).
3. Task 2에서 확인한 연결 코드가 있다면 재사용, 없으면 브라우저 콘솔에서 `fetch('/api/talent-search-extension-token', {method:'POST'}).then(r=>r.json()).then(console.log)`로 새로 발급.
4. 이력서 업데이트가 오래된(200일 전) 더미 후보 + 경력이 프로젝트 범위 밖인 더미 후보 + 정상 후보를 섞어서 전송:

```js
fetch('/api/talent-search-projects/<프로젝트ID>/list-candidates', {
  method: 'POST',
  headers: {'Content-Type':'application/json', 'Authorization':'Bearer <연결코드>'},
  body: JSON.stringify({ platform: '사람인', candidates: [
    { maskedName: '정상후보', careerSummary: '경력 5년', lastUpdatedLabel: '26-08-01 업데이트', sourceUrl: 'https://x.com/1' },
    { maskedName: '이력서오래됨', careerSummary: '경력 5년', lastUpdatedLabel: '25-01-01 업데이트', sourceUrl: 'https://x.com/2' },
    { maskedName: '경력밖', careerSummary: '신입', lastUpdatedLabel: '26-08-01 업데이트', sourceUrl: 'https://x.com/3' }
  ] })
}).then(r=>r.json()).then(console.log)
```

(위 예시는 프로젝트의 `experience_min_years`가 3 이상인 경우를 가정한다 — 실제 값에 맞춰 "신입"이 걸리도록 후보를 조정할 것.)

5. 응답의 `imported`/`skipped`/`skippedReasons`가 기대와 일치하는지 확인(예: `{ imported: 1, skipped: 2, skippedReasons: { resumeStale: 1, careerOutOfRange: 1 } }`)
6. `GET /api/talent-search-projects/<프로젝트ID>/list-candidates`로 조회해서 실제로 저장된 건 "정상후보" 하나뿐인지 확인
7. 검증에 쓴 더미 후보 행을 정리: `DELETE FROM talent_search_list_candidates WHERE masked_name IN ('정상후보')` (또는 project_id로 범위를 좁혀 전체 정리)

- [ ] **Step 4: 커밋**

```bash
git add handlers/_lib/talentSearchPolicy.js "handlers/talent-search-projects/[id]/list-candidates.js"
git commit -m "$(cat <<'EOF'
feat: 리스트 후보 저장 API에 Level1 자동필터 통합

저장 전 evaluateListCandidate로 명확히 조건 밖(이력서 업데이트
180일 초과, 경력연수 범위 밖)인 후보를 걸러낸다. 판정 기준은
프로젝트가 승인 시점에 고정한 정책 버전을 쓴다. 응답에
skipped/skippedReasons 추가.
EOF
)"
```

---

### Task 3: 크롬 확장 — "다음 페이지" 버튼 탐색 + 클릭

**Files:**
- Modify: `chrome-extension/list-content-lib.js`
- Modify: `chrome-extension/list-content-lib.test.js`
- Modify: `chrome-extension/list-content.js`

**Interfaces:**
- Produces: `list-content-lib.js`에 `export function findNextPageButton(doc)` 추가 — "다음 페이지" 요소(클릭 가능한 `Element`)를 찾아 반환, 못 찾으면 `null`. `list-content.js`가 새 메시지 타입 `CLICK_NEXT_PAGE`에 응답해 `{hasNextPage: boolean, blocked: boolean}`을 돌려준다 — Task 4(팝업)가 이 메시지 계약을 그대로 쓴다.

- [ ] **Step 1: 실제 사람인 검색결과 리스트 페이지의 페이지네이션 DOM을 먼저 확인한다**

`.talent_list_item`(카드), `.check_area[residx]` 등 기존 선택자를 확정했을 때와 같은 방식이다 — 이 스텝의 코드는 실사용 확인 전 합리적인 추정이니, 실제 화면 구조와 다르면 이 스텝의 선택자만 고치고 함수 시그니처(인자/반환값 모양)는 유지한다. 로그인해서 실제 검색결과 화면 하단의 페이지 번호/"다음" 영역을 개발자도구로 확인하고, "다음 페이지로 이동하는 클릭 가능한 요소"가 어떤 태그/클래스/텍스트인지 기록한다(마지막 페이지에서는 이 요소가 아예 없거나 비활성화(`disabled`/`aria-disabled`) 상태로 나오는지도 같이 확인).

- [ ] **Step 2: `findNextPageButton` 작성 (실제 확인한 선택자로 교체)**

`chrome-extension/list-content-lib.js` 맨 아래에 추가:

```js
// "다음 페이지" 요소를 찾는다. 텍스트("다음")와 클래스명 둘 다로
// 찾는 이유: 사람인이 클래스명을 바꿔도 텍스트 매칭이 살아있으면
// 완전히 못 찾는 상황을 피할 수 있다. 마지막 페이지에서 비활성화된
// 요소(disabled 속성 또는 aria-disabled="true")는 제외한다 --
// 존재하지만 눌러도 반응 없는 요소를 클릭 성공으로 잘못 보고하면
// CLICK_NEXT_PAGE 호출부가 무한정 같은 페이지를 반복하게 된다.
// 선택자는 2026-08-27 실사용 확인 기준 선택자들(.talent_list_item 등)과
// 마찬가지로 실제 화면 구조가 바뀌면 깨질 수 있다.
export function findNextPageButton(doc) {
  const candidates = Array.from(doc.querySelectorAll('a, button'));
  const isDisabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true'
    || (el.className && String(el.className).includes('disabled'));
  return candidates.find(el =>
    !isDisabled(el) && (
      /^\s*다음\s*$/.test(el.textContent || '') ||
      (el.className && String(el.className).includes('btn_next'))
    )
  ) || null;
}
```

- [ ] **Step 3: 테스트 작성 (jsdom)**

`chrome-extension/list-content-lib.test.js` 맨 아래에 추가(기존 import 줄의 `parseCandidateCard` 옆에 `findNextPageButton`도 추가):

```js
import { parseCandidateCard, findNextPageButton } from './list-content-lib.js';
```

```js
test('findNextPageButton: 활성화된 다음 버튼을 찾는다', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_prev">이전</a><a class="btn_next">다음</a></div>');
  const btn = findNextPageButton(dom.window.document);
  assert.equal(btn.textContent, '다음');
});

test('findNextPageButton: 비활성화된 버튼은 무시한다', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_next disabled" aria-disabled="true">다음</a></div>');
  assert.equal(findNextPageButton(dom.window.document), null);
});

test('findNextPageButton: 없으면 null', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_prev">이전</a></div>');
  assert.equal(findNextPageButton(dom.window.document), null);
});
```

- [ ] **Step 4: 테스트 실행**

Run: `node --test chrome-extension/list-content-lib.test.js`
Expected: 기존 테스트 포함 모두 PASS(신규 3개 추가)

(주의: Step 1에서 확인한 실제 선택자가 Step 2의 추정과 다르면, Step 2의 구현과 이 테스트의 fixture HTML을 실제 선택자에 맞게 같이 고친다 — `.talent_list_item` 선택자를 확정했을 때와 동일한 절차.)

- [ ] **Step 5: `list-content.js`에 `CLICK_NEXT_PAGE` 핸들러 추가**

`chrome-extension/list-content.js`의 파일 상단 주석과 `chrome.runtime.onMessage.addListener(...)` 블록 전체를 아래로 교체(그 위의 `getLib`/`getBlockedCheck`/`CANDIDATE_CARD_SELECTOR`는 그대로 둔다):

```js
// chrome-extension/list-content.js
// 사람인 검색결과 리스트 페이지에 주입된다. 팝업의 "이 페이지
// 가져오기" 클릭을 받으면(PARSE_CURRENT_LIST) 로그인/인증 화면인지
// 먼저 확인하고(2단계인증 화면을 실제로 겪어봤다), 아니면 현재 화면에
// 보이는 후보 카드들을 파싱해서 돌려준다. 목표 인원을 채우기 위해
// 팝업이 여러 페이지를 반복 수집할 때는 CLICK_NEXT_PAGE로 "다음
// 페이지" 요소를 대신 찾아 클릭한다(2026-08-28 추가) -- 이 파일
// 자체는 스크롤하거나 페이지를 판단하지 않는다, 클릭 한 번만 담당하고
// 반복 여부와 페이지 간 지연은 팝업(popup.js)이 주도한다. 이 파일은
// manifest에 classic 스크립트로 선언돼 있어 최상위 import 문을 쓸 수
// 없다 -- 순수 함수는 동적 import()로 가져온다(content.js와 동일한
// 패턴).
```

그리고 파일 맨 아래(기존 `chrome.runtime.onMessage.addListener(...)` 전체)를 아래로 교체:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_CURRENT_LIST') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        // 로그인/2단계인증 화면에서는 카드 선택자가 그냥 하나도 안
        // 걸려서 "0명"으로 조용히 성공한 것처럼 보일 위험이 있다 --
        // blocked 플래그로 구분해서 팝업이 다른 메시지를 보여주게 한다.
        sendResponse({ candidates: [], blocked: true });
        return;
      }

      const { parseCandidateCard } = await getLib();
      const cards = Array.from(document.querySelectorAll(CANDIDATE_CARD_SELECTOR));
      const candidates = cards.map(parseCandidateCard).filter(c => c.maskedName && c.sourceUrl);
      sendResponse({ candidates, blocked: false });
    })();
    return true; // 비동기 응답을 위해 채널을 열어둔다
  }

  if (message.type === 'CLICK_NEXT_PAGE') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        // 클릭 자체가 예상 못한 팝업/리디렉션을 유발할 수 있어서
        // 클릭 전에도 한 번 더 확인한다(PARSE_CURRENT_LIST 쪽과 이중
        // 방어).
        sendResponse({ hasNextPage: false, blocked: true });
        return;
      }

      const { findNextPageButton } = await getLib();
      const nextBtn = findNextPageButton(document);
      if (!nextBtn) {
        sendResponse({ hasNextPage: false, blocked: false });
        return;
      }
      nextBtn.click();
      sendResponse({ hasNextPage: true, blocked: false });
    })();
    return true;
  }

  return false;
});
```

- [ ] **Step 6: 커밋**

```bash
git add chrome-extension/list-content-lib.js chrome-extension/list-content-lib.test.js chrome-extension/list-content.js
git commit -m "$(cat <<'EOF'
feat: 크롬 확장에 '다음 페이지' 탐색+클릭(CLICK_NEXT_PAGE) 추가

findNextPageButton(순수함수, 비활성화 버튼 제외)과 콘텐츠 스크립트
메시지 핸들러 신설. 반복 여부·지연은 팝업이 주도하고 이 파일은
클릭 한 번만 담당한다.
EOF
)"
```

---

### Task 4: 크롬 확장 — 팝업 자동 페이지 넘김 루프

**Files:**
- Modify: `chrome-extension/popup.html`
- Modify: `chrome-extension/popup.js`

**Interfaces:**
- Consumes: `POST .../list-candidates`의 `{imported, skipped, skippedReasons}` 응답(Task 2), `CLICK_NEXT_PAGE` 메시지의 `{hasNextPage, blocked}` 응답(Task 3).

- [ ] **Step 1: 목표 인원 입력칸 추가**

`chrome-extension/popup.html`의 `listImportSection` 블록 — 기존:

```html
  <div id="listImportSection" style="display:none;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #ddd;">
    <div style="font-size:12px;color:#555;margin-bottom:4px;">가져올 검색 프로젝트</div>
    <select id="projectSelect" style="width:100%;"></select>
    <button id="importBtn" style="margin-top:8px;">이 페이지 가져오기</button>
    <div id="importStatus" style="font-size:11px;color:#555;margin-top:4px;"></div>
  </div>
```

새 코드(목표 인원 입력칸 추가, 버튼 문구 변경):

```html
  <div id="listImportSection" style="display:none;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #ddd;">
    <div style="font-size:12px;color:#555;margin-bottom:4px;">가져올 검색 프로젝트</div>
    <select id="projectSelect" style="width:100%;"></select>
    <div style="font-size:12px;color:#555;margin-top:8px;margin-bottom:4px;">목표 인원 (필터 통과 기준)</div>
    <input id="targetCountInput" type="number" min="1" value="50" style="width:100%;box-sizing:border-box;padding:4px;">
    <button id="importBtn" style="margin-top:8px;">목표 인원 채우기</button>
    <div id="importStatus" style="font-size:11px;color:#555;margin-top:4px;"></div>
  </div>
```

- [ ] **Step 2: `popup.js`의 `importBtn` 클릭 핸들러를 반복 루프로 교체**

`chrome-extension/popup.js`에서 `const listImportSection = ...` 아래 상수 선언 줄에 `targetCountInput`을 추가:

```js
const listImportSection = document.getElementById('listImportSection');
const projectSelect = document.getElementById('projectSelect');
const targetCountInput = document.getElementById('targetCountInput');
const importBtn = document.getElementById('importBtn');
const importStatus = document.getElementById('importStatus');
```

기존 `importBtn.addEventListener('click', async () => { ... });` 블록 전체를 아래로 교체:

```js
// 한 번의 "가져오기" 클릭이 넘길 수 있는 최대 페이지 수. 무한정
// 페이지를 넘기지 않도록 하는 안전장치이지 정책값이 아니라서 상수로만
// 관리한다(설계문서 참고) -- 더 필요하면 사람인에서 수동으로 몇 페이지
// 넘긴 뒤 다시 누르면 된다.
const MAX_PAGES = 5;

function randomPageDelayMs() {
  // 페이지 이동마다 정확히 같은 간격으로 클릭하지 않도록 2.5~4.5초
  // 사이 무작위 지연을 둔다(사람처럼 보이게 하는 안전장치 -- 실행엔진
  // OCR 작업 중 실제로 2단계인증을 겪은 적이 있어서 도입).
  return 2500 + Math.random() * 2000;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

importBtn.addEventListener('click', async () => {
  const token = await loadSavedToken();
  const projectId = projectSelect.value;
  if (!token || !projectId) return;

  const target = Math.max(1, Number(targetCountInput.value) || 50);
  importBtn.disabled = true;

  const seenUrls = new Set();
  let totalImported = 0;
  let totalSkipped = 0;
  let pageCount = 0;
  let stopReason = null;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      pageCount += 1;
      importStatus.textContent = `${pageCount}페이지째 가져오는 중... (지금까지 ${totalImported}명 확보)`;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const parseResult = await chrome.tabs.sendMessage(tab.id, { type: 'PARSE_CURRENT_LIST' });
      if (parseResult && parseResult.blocked) {
        stopReason = '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요';
        break;
      }

      const allCandidates = (parseResult && parseResult.candidates) || [];
      // 같은 페이지를 다시 읽게 된 경우(다음 페이지 클릭이 실제로는
      // 안 먹힌 경우 등)를 새 후보 0명으로 자연스럽게 감지하기 위해,
      // 이번 "가져오기" 세션 동안 이미 본 sourceUrl은 다시 보내지
      // 않는다.
      const newCandidates = allCandidates.filter(c => c.sourceUrl && !seenUrls.has(c.sourceUrl));
      if (!newCandidates.length) {
        stopReason = pageCount === 1 ? '가져올 후보를 찾지 못했어요' : '더 이상 새로운 후보가 없어요';
        break;
      }
      newCandidates.forEach(c => seenUrls.add(c.sourceUrl));

      const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects/${projectId}/list-candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ platform: '사람인', candidates: newCandidates })
      });
      const data = await res.json();
      if (!res.ok) {
        stopReason = data.error || '가져오기 실패';
        break;
      }

      totalImported += data.imported;
      totalSkipped += data.skipped || 0;

      if (totalImported >= target) break;

      if (pageCount >= MAX_PAGES) {
        stopReason = `안전 상한(${MAX_PAGES}페이지)에 도달해 멈췄어요. 필요하면 사람인에서 직접 다음 페이지로 이동한 뒤 다시 눌러주세요.`;
        break;
      }

      const nextResult = await chrome.tabs.sendMessage(tab.id, { type: 'CLICK_NEXT_PAGE' });
      if (!nextResult || nextResult.blocked) {
        stopReason = '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요';
        break;
      }
      if (!nextResult.hasNextPage) {
        stopReason = '마지막 페이지예요';
        break;
      }

      await wait(randomPageDelayMs());
    }

    if (totalImported === 0) {
      importStatus.textContent = stopReason || '가져올 후보를 찾지 못했어요';
    } else {
      let summary = pageCount > 1
        ? `${pageCount}페이지에 걸쳐 ${totalImported}명 가져왔어요`
        : `${totalImported}명 가져왔어요`;
      if (totalSkipped) summary += ` (${totalSkipped}명은 조건에 안 맞아 제외)`;
      if (stopReason) summary += ` — ${stopReason}`;
      importStatus.textContent = summary;
    }
  } catch (err) {
    importStatus.textContent = `오류: ${err.message}`;
  } finally {
    importBtn.disabled = false;
  }
});
```

- [ ] **Step 3: 실제 크롬에서 끝까지 검증 (컨트롤러가 사용자와 함께 직접 진행)**

서브에이전트는 브라우저 접근이 없으므로 이 스텝은 반드시 실제 크롬 확장을 리로드해서 진행한다.

1. `chrome://extensions`에서 이 확장을 리로드
2. 사람인에 로그인한 상태로 실제 검색결과 리스트 화면을 연다(한 페이지에 목표 인원보다 적은 인원이 나오는 검색어로 — 여러 페이지 넘김을 실제로 확인하기 위해)
3. 확장 팝업에서 승인된 프로젝트 선택, 목표 인원을 예를 들어 30으로 설정, "목표 인원 채우기" 클릭
4. 페이지가 실제로 자동으로 넘어가는지, 상태 텍스트가 페이지마다 갱신되는지, 페이지 사이에 짧은 지연이 있는지 눈으로 확인
5. 목표 인원 도달 시 정상 종료 메시지 확인(예: `"2페이지에 걸쳐 34명 가져왔어요 (4명은 조건에 안 맞아 제외)"`)
6. 목표 인원을 일부러 매우 크게(예: 500) 설정해서 안전 상한(5페이지)에서 멈추는지, 안내 문구가 뜨는지 확인
7. 마지막 페이지까지 도달하는 검색어로 다시 시도해서 "마지막 페이지예요"로 정상 종료하는지 확인
8. HR 사이트의 "검색 진행 → 실제 후보 리스트" 화면에서 실제로 여러 페이지분의 후보가 저장돼 있는지 확인
9. 검증에 쓴 테스트 데이터 정리: `DELETE FROM talent_search_list_candidates WHERE project_id = '<검증에 쓴 프로젝트ID>'`

- [ ] **Step 4: 커밋**

```bash
git add chrome-extension/popup.html chrome-extension/popup.js
git commit -m "$(cat <<'EOF'
feat: 크롬 확장 팝업에 목표인원 채우기(자동 페이지 넘김) 추가

목표 인원(기본 50)을 필터 통과 기준으로 채울 때까지 파싱→저장→
CLICK_NEXT_PAGE→무작위 지연을 반복. 안전 상한 5페이지, 로그인화면
감지, 세션 내 중복방지(sourceUrl Set)를 안전장치로 둔다.
EOF
)"
```

---

## Self-Review

**스펙 커버리지**: 저장전 필터(이력서 업데이트일 Task1+2, 경력연수 Task1+2, 판단불가=통과 Task1), 응답 확장(Task2), 자동 페이지 넘김(목표인원 Task4, 반복흐름 Task3+4, 안전장치 4종 전부 Task3/4에 매핑) — 스펙 문서의 모든 섹션이 태스크에 대응된다. 재직여부 필터·감사로그·DB 유니크 제약은 스펙에서도 명시적 범위 밖이라 태스크 없음(의도됨).

**플레이스홀더 스캔**: 없음. "다음 페이지" 선택자는 명시적으로 "실사용 확인 전 추정치, 실제 확인 후 교체"로 표시됨(기존 카드 선택자 확정 때와 동일한 절차 — TBD가 아니라 구체적인 시작 코드).

**타입/시그니처 일관성**: `evaluateListCandidate(candidate, config, refDate)` 반환 `{skip, reasons}` — Task1 정의, Task2 소비 동일. `findNextPageButton(doc)` — Task3 정의·테스트·소비(`document` 전달) 동일. 응답 필드 `imported`/`skipped`/`skippedReasons` — Task2 생성, Task4 소비 동일. `CLICK_NEXT_PAGE` 요청/`{hasNextPage, blocked}` 응답 — Task3 생성, Task4 소비 동일.

## 실행 순서

Task 1 → Task 2(서버 완결, 여기서 curl 검증까지 끝남) → Task 3 → Task 4(확장 완결, 여기서 실크롬 검증). Task 1~2와 Task 3~4는 서로 독립적이라 순서를 바꿔도(Task 3 → 4 → 1 → 2) 무방하지만, 병렬로 두 서브에이전트를 동시에 돌리기보다는 순차 진행을 권장한다 — Task 4의 실크롬 검증이 Task 2가 이미 배포한 서버 응답 모양에 의존하기 때문이다.
