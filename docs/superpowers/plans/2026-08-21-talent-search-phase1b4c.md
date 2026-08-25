# 인재검색 Phase 1B-4c (가상 후보 3명 미리보기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기준 관리센터 화면 맨 아래에, 원본 명세서 채점 공식으로 가상 후보 3명(강함/애매함/약함)의 Level1·공통40점·직무60점·총점·최종판정을 계산해서 보여주는 "가상 후보 미리보기" 섹션을 추가한다. 초안이 있으면 기존/초안 판정을 나란히 보여준다.

**Architecture:** 새 API 없음 — `index.html`에 고정 상수(`VIRTUAL_CANDIDATES`)와 순수 계산 함수 몇 개(`evaluateLevel1`/`scoreItemGroup`/`simulateCandidate`)를 추가하고, `loadAndRenderTalentSearchPolicy()`가 이미 받아온 `policy`/`draft` 객체를 그대로 넘겨 표를 그린다(`renderVirtualCandidatePreview`). 이걸로 Phase 1B(평가·검색 기준 관리센터) 전체가 끝난다.

**Tech Stack:** Vanilla JS(프론트엔드 전용, 서버 변경 없음).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-21-talent-search-phase1b4c-design.md` — 정확한 계산식/후보 데이터는 이 문서에서 그대로 가져온다.
- 새 API 없음, 스키마 변경 없음 — `index.html` 한 파일만 수정한다.
- 가상 후보 3명은 코드에 고정: 후보 A(강함, resumeAgeDays=20/shortTenureCount=0/gapMonths=0/패턴 명확,명확,부분,명확,명확), 후보 B(애매함, 140/1/8/부분,약함,부분,약함,부분), 후보 C(약함, 220/3/15/약함,없음,없음,약함,없음).
- 근거수준 패턴은 **항목 배열의 순서**로 매칭(인덱스를 패턴 길이로 나눈 나머지로 순환) — 항목 이름(key)으로 매칭하지 않는다.
- 점수 계산: `항목점수 = 항목배점 × 근거계수`, `policy.roundingRule.unit`(기본 0.5) 단위로 반올림하되 `policy.roundingRule.tieBreak==='roundUp'`이면 정확히 중간일 때 올림. 그룹 총점 = 반올림된 항목점수의 합.
- Level1 판정: 이력서 업데이트일이 `passWithinDays` 이하면 PASS, `verifyWithinDays` 이하면 VERIFY, 초과면 FAIL. 단기근속 횟수가 `countThreshold` 이상이면 VERIFY, 아니면 PASS. 경력공백이 `ignoreUnderMonths` 미만이면 PASS, 아니면 VERIFY(FAIL 없음 — 원본 명세 5.3 "설명 필요"는 자동 제외가 아님). 셋 중 하나라도 FAIL이면 종합 FAIL, 하나라도 VERIFY면 VERIFY, 전부 PASS면 PASS.
- 최종판정: Level1=FAIL → "제외", Level1=VERIFY → "확인 필요", Level1=PASS이고 (총점≥`thresholds.totalScoreMin` AND 직무60점≥`thresholds.jobFitScoreMin` AND 의미있는근거개수≥`thresholds.minMeaningfulEvidenceCount`)면 "추천", 아니면 "확인 필요". 의미있는 근거 = 근거수준이 "부분" 또는 "명확"인 항목 수(공통40+직무60 합산).
- 직무별 필수/제외조건 하드필터는 시뮬레이션에 없음(아직 검색 프로젝트가 없어 존재하지 않는 개념).
- 이 프로젝트는 순수 계산 로직을 `node --test`로 단위테스트하지만, 이번 계산 함수는 `index.html`의 인라인 `<script>` 안에서만 존재해서(별도 ES 모듈이 아님) 이 파일의 다른 클라이언트 계산 로직(`renderPolicyDiff`, KPI 계산 등)과 마찬가지로 **로컬 dev 서버 브라우저 수동 검증**으로 확인한다 — 새 테스트 파일을 만들지 않는다.
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다.
- 테스트 계정: `preview-test@selfdiylab.invalid` / `Preview1234` (ADMIN).

---

### Task 1: 가상 후보 계산 함수 + 미리보기 섹션 추가

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `loadAndRenderTalentSearchPolicy()`가 이미 갖고 있는 `policy`(활성 정책)와 `draft`(초안, 없으면 `null`) 지역 변수.
- Produces: 없음(화면 종단). `VIRTUAL_CANDIDATES`, `evaluateLevel1(candidate, l1Rules)`, `scoreItemGroup(items, pattern, evidenceCoefficients, roundingRule)`, `simulateCandidate(candidate, policy)`, `renderVirtualCandidatePreview(activePolicy, draftPolicy)`가 새로 생김.

- [ ] **Step 1: 가상 후보 데이터 + 계산 함수 추가**

`renderThresholdsBody` 함수 바로 다음, `renderPolicyDiff` 함수 시작 전(즉 아래 "현재" 블록의 두 함수 사이)에 새 코드를 끼워 넣는다. 현재:

```js
function renderThresholdsBody(t, capDefault, capMax){
  return `<div class="grid4">
    <div class="kpi"><div class="label">총점 기준</div><div class="value">${t.totalScoreMin}점 이상</div></div>
    <div class="kpi"><div class="label">직무점수 기준</div><div class="value">${t.jobFitScoreMin}점 이상</div></div>
    <div class="kpi"><div class="label">의미있는 근거</div><div class="value">${t.minMeaningfulEvidenceCount}개 이상</div></div>
    <div class="kpi"><div class="label">하루 추천 상한</div><div class="value">${capDefault}명</div><div style="font-size:11px;color:var(--sub);margin-top:4px;">절대 상한 ${capMax}명</div></div>
  </div>`;
}
function renderPolicyDiff(active, draft){
```

이걸 아래로 교체(`renderThresholdsBody` 그대로 두고 그 다음에 새 코드 삽입, `renderPolicyDiff` 시작 줄은 그대로):

```js
function renderThresholdsBody(t, capDefault, capMax){
  return `<div class="grid4">
    <div class="kpi"><div class="label">총점 기준</div><div class="value">${t.totalScoreMin}점 이상</div></div>
    <div class="kpi"><div class="label">직무점수 기준</div><div class="value">${t.jobFitScoreMin}점 이상</div></div>
    <div class="kpi"><div class="label">의미있는 근거</div><div class="value">${t.minMeaningfulEvidenceCount}개 이상</div></div>
    <div class="kpi"><div class="label">하루 추천 상한</div><div class="value">${capDefault}명</div><div style="font-size:11px;color:var(--sub);margin-top:4px;">절대 상한 ${capMax}명</div></div>
  </div>`;
}

// 1B-4c: 가상 후보 3명 미리보기. 실제 이력서 평가 엔진(Phase 2+)이 아직 없어서
// 원본 명세서 채점 공식을 그대로 이용해 미리 정해둔 합성 후보에 지금 정책을
// 적용해보는 시뮬레이션이다. 근거수준 패턴은 항목 key가 아니라 배열
// 순서(인덱스 % 패턴길이)로 매칭한다 -- 공통40점/직무60점 항목은 자유롭게
// 추가/삭제되므로 이름 기반 매칭은 항목이 바뀌면 깨진다.
const VIRTUAL_CANDIDATES = [
  { name: '후보 A (강함)', resumeAgeDays: 20, shortTenureCount: 0, gapMonths: 0,
    evidencePattern: ['명확','명확','부분','명확','명확'] },
  { name: '후보 B (애매함)', resumeAgeDays: 140, shortTenureCount: 1, gapMonths: 8,
    evidencePattern: ['부분','약함','부분','약함','부분'] },
  { name: '후보 C (약함)', resumeAgeDays: 220, shortTenureCount: 3, gapMonths: 15,
    evidencePattern: ['약함','없음','없음','약함','없음'] }
];

function evidenceCoeff(level, ec){
  return { '없음': ec.none, '약함': ec.weak, '부분': ec.partial, '명확': ec.clear }[level];
}
function roundToUnit(value, unit, tieBreak){
  const ratio = value / unit;
  const rounded = tieBreak === 'roundUp' ? Math.floor(ratio + 0.5) : Math.round(ratio);
  return Math.round(rounded * unit * 100) / 100;
}
function scoreItemGroup(items, pattern, evidenceCoefficients, roundingRule){
  let total = 0, meaningfulCount = 0;
  items.forEach((item, i) => {
    const level = pattern[i % pattern.length];
    const raw = item.points * evidenceCoeff(level, evidenceCoefficients);
    total += roundToUnit(raw, roundingRule.unit, roundingRule.tieBreak);
    if(level === '부분' || level === '명확') meaningfulCount++;
  });
  return { total: Math.round(total * 100) / 100, meaningfulCount };
}
// 이력서 업데이트/단기근속/경력공백을 정책 임계값과 비교해 Level1 종합판정을
// 낸다. 원본 명세는 단기근속·경력공백에 "제외 검토"/"설명 필요"라는 판단
// 영역을 두지만 자동 FAIL로 명시하지 않아서, 이 시뮬레이션에서는 둘 다
// VERIFY로 단순화한다 -- FAIL은 이력서 업데이트 180일 초과처럼 명세가 명확히
// "자동 추천 제외"라고 못박은 경우에만 나온다.
function evaluateLevel1(candidate, l1){
  let resumeStatus;
  if(candidate.resumeAgeDays <= l1.resumeUpdated.passWithinDays) resumeStatus = 'PASS';
  else if(candidate.resumeAgeDays <= l1.resumeUpdated.verifyWithinDays) resumeStatus = 'VERIFY';
  else resumeStatus = 'FAIL';

  const tenureStatus = candidate.shortTenureCount >= l1.shortTenure.countThreshold ? 'VERIFY' : 'PASS';
  const gapStatus = candidate.gapMonths < l1.careerGap.ignoreUnderMonths ? 'PASS' : 'VERIFY';

  const statuses = [resumeStatus, tenureStatus, gapStatus];
  if(statuses.includes('FAIL')) return 'FAIL';
  if(statuses.includes('VERIFY')) return 'VERIFY';
  return 'PASS';
}
function simulateCandidate(candidate, policy){
  const level1Status = evaluateLevel1(candidate, policy.level1Rules);
  const common = scoreItemGroup(policy.commonFitWeights, candidate.evidencePattern, policy.evidenceCoefficients, policy.roundingRule);
  const jobFit = scoreItemGroup(policy.jobFitDefaultWeights, candidate.evidencePattern, policy.evidenceCoefficients, policy.roundingRule);
  const totalScore = Math.round((common.total + jobFit.total) * 100) / 100;
  const meaningfulCount = common.meaningfulCount + jobFit.meaningfulCount;
  let verdict;
  if(level1Status === 'FAIL') verdict = '제외';
  else if(level1Status === 'VERIFY') verdict = '확인 필요';
  else {
    const meets = totalScore >= policy.thresholds.totalScoreMin &&
                  jobFit.total >= policy.thresholds.jobFitScoreMin &&
                  meaningfulCount >= policy.thresholds.minMeaningfulEvidenceCount;
    verdict = meets ? '추천' : '확인 필요';
  }
  return { level1Status, commonScore: common.total, jobFitScore: jobFit.total, totalScore, meaningfulCount, verdict };
}
function verdictBadgeClass(v){
  return v === '추천' ? 'badge green' : v === '제외' ? 'badge red' : 'badge grey';
}
function renderVirtualCandidatePreview(activePolicy, draftPolicy){
  const rows = VIRTUAL_CANDIDATES.map(c => {
    const activeResult = simulateCandidate(c, activePolicy);
    const draftResult = draftPolicy ? simulateCandidate(c, draftPolicy) : null;
    const changed = draftResult && draftResult.verdict !== activeResult.verdict;
    return `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${activeResult.level1Status}</td>
        <td>${activeResult.commonScore}</td>
        <td>${activeResult.jobFitScore}</td>
        <td>${activeResult.totalScore}</td>
        <td><span class="${verdictBadgeClass(activeResult.verdict)}">${activeResult.verdict}</span></td>
        ${draftPolicy ? `<td${changed ? ' style="background:#fff3cd;"' : ''}><span class="${verdictBadgeClass(draftResult.verdict)}">${draftResult.verdict}</span></td>` : ''}
      </tr>
    `;
  }).join('');
  return `
    <div class="section">
      <div class="section-head"><div><h3>가상 후보 미리보기</h3><div class="desc">실제 이력서 평가가 아니라, 지금 정책이 대략 어떻게 작동하는지 감을 잡기 위한 시뮬레이션이에요</div></div></div>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>후보</th><th>Level1</th><th>공통40점</th><th>직무60점</th><th>총점</th><th>판정${draftPolicy ? '(기존)' : ''}</th>${draftPolicy ? '<th>판정(초안)</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    </div>
  `;
}

function renderPolicyDiff(active, draft){
```

- [ ] **Step 2: `loadAndRenderTalentSearchPolicy`의 렌더링 끝에 미리보기 섹션 추가**

현재(함수 안, 마지막 카드 다음):

```html
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      ${renderThresholdsBody(view.thresholds, view.dailyRecommendCapDefault, view.dailyRecommendCapAbsoluteMax)}
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditThresholdsModal()">수정</button>
    </div>
  `;
  }catch(err){ el.innerHTML = `<div class="section">${escapeHtml(err.message)}</div>`; }
```

이걸 아래로 교체(카드 뒤에 미리보기 섹션 한 줄 추가):

```html
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      ${renderThresholdsBody(view.thresholds, view.dailyRecommendCapDefault, view.dailyRecommendCapAbsoluteMax)}
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditThresholdsModal()">수정</button>
    </div>
    ${renderVirtualCandidatePreview(policy, draft)}
  `;
  }catch(err){ el.innerHTML = `<div class="section">${escapeHtml(err.message)}</div>`; }
```

주의: `renderVirtualCandidatePreview`의 첫 번째 인자는 항상 **활성 정책**(`policy`)이다 — 카드들이 보여주는 `view`(초안 있으면 초안)와 다르다. 미리보기는 "기존"과 "초안"을 비교하는 게 목적이라 활성값을 기준선으로 고정해야 한다.

- [ ] **Step 3: 수동 확인 — 초안 없을 때 / 있을 때 두 경우**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정으로 로그인 → 인재검색 → 기준 관리센터. 브라우저 콘솔 에러 없는지 확인.

1. **초안이 없는 상태**: 화면 맨 아래에 "가상 후보 미리보기" 섹션이 뜬다. 표에 후보 A/B/C 세 줄, "판정" 열 하나만 있고(초안 열 없음). 지금 활성 정책 기본값(원본 명세서 초기값이면: passWithinDays=90, verifyWithinDays=180, shortTenure countThreshold=2, careerGap ignoreUnderMonths=6) 기준으로 계산했을 때:
   - 후보 A: Level1=PASS(20일 이내, 단기근속 0<2, 공백 0<6) → 총점이 임계값(70점 이상, 직무60점 42점 이상) 넘으면 "추천"
   - 후보 B: 이력서 140일(90 초과, 180 이하) → Level1=VERIFY → 최종판정 "확인 필요" (점수와 무관하게)
   - 후보 C: 이력서 220일(180 초과) → Level1=FAIL → 최종판정 "제외"
   (활성 정책이 원본 초기값과 다르게 이미 편집돼 있을 수도 있으니, 정확한 숫자보다 "B는 애매한 케이스라 확인필요/제외 어느 쪽이든 나올 수 있고, C는 이력서 180일 초과 조건에 걸리면 항상 제외"라는 논리 흐름이 맞는지 위주로 확인)
2. **Level1 기준(1차 필터) 카드를 "수정"으로 고쳐서 초안 만들기**: 이력서 업데이트 "확인필요 기준"을 아주 크게(예: 300일)로 바꿔서 저장 → 화면에 초안 배너가 뜨고, "가상 후보 미리보기" 표에 "판정(기존)"/"판정(초안)" 두 열이 다 보이는지 확인. 후보 C(220일)가 이제 300일 이하라 VERIFY로 바뀌어서 "판정(초안)"이 "제외"에서 "확인 필요"로 바뀌었는지, 그 셀이 색깔로 강조되는지 확인.
3. 그 초안을 "초안 버리기"로 지워서 원래 상태로 복구한다(테스트 흔적 안 남기기).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 기준 관리센터에 가상 후보 3명 미리보기 섹션 추가 (Phase 1B 마지막 조각)"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 "포함" 항목(가상 후보 3명 고정 데이터, 채점 시뮬레이션 계산 함수, 활성+초안 비교 화면 섹션)이 전부 Task 1에 매핑됨. "포함 안 함"(실제 평가 엔진, 하드필터, 후보 편집 UI, 새 API)은 코드에 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음 — Step 1/2에 실제 코드 전문이 포함됨.
- **타입/이름 일관성**: `VIRTUAL_CANDIDATES`/`evaluateLevel1`/`scoreItemGroup`/`simulateCandidate`/`renderVirtualCandidatePreview` 함수명이 Step 1 정의와 Step 2 호출부에서 동일하게 쓰임. `renderVirtualCandidatePreview(policy, draft)` 호출 시 인자 순서(활성이 먼저)가 함수 시그니처 `(activePolicy, draftPolicy)`와 일치.
- **회귀 방지**: `renderThresholdsBody`/`renderPolicyDiff` 등 기존 함수는 이 Task에서 내용 변경 없이 그 사이에 새 코드만 끼워 넣으므로, 기존 카드 렌더링·초안 비교 동작에 영향 없음 — Step 3의 수동 확인에서 기존 화면 요소(카드 5개, 배너)가 그대로인지도 같이 확인한다.

## 실행 순서 안내

Task 1 하나로 끝나는 단일 작업이다(백엔드 변경이 없어서 나눌 이유가 없음).

Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 "가상 후보 미리보기" 표 화면 캡처(초안 없을 때/있을 때 둘 다)
2. Level1 기준을 바꿔서 후보 판정이 실제로 바뀌는 걸 보여주는 캡처
3. **Phase 1B(평가·검색 기준 관리센터) 전체 완료 확인** — 다음은 Phase 1C(새 인재검색 입력) 착수 여부, 그리고 지금까지 계속 미뤄온 프로덕션 DB 마이그레이션(`sql/015`/`sql/016`)을 이 시점에 반영할지 논의
