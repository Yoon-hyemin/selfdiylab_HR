# 인재검색 Phase 1B-1 — 기준 관리센터 데이터 구조 + 읽기전용 화면

- 작성일: 2026-08-19
- 선행 문서: `docs/superpowers/specs/2026-08-19-talent-search-automation-design.md`(전체 아키텍처), `인재검색_자동화_마스터프롬프트_원본.md` 5~7장(채점 로직 원본 값), 12.3절 H(기준 관리센터 화면 명세)
- 관련 기존 파일: `sql/015_talent_search.sql`(Phase 1A), `handlers/_lib/accountAuth.js`, `index.html`의 `renderTalentSearchDashboard()`/`applySidebarForRole()`

## 배경

Phase 1B는 "평가·검색 기준 관리센터"(Level1 문턱값, 공통 40점, 직무 60점, 임계값, 하루상한을 화면에서 편집)를 통째로 다루기엔 범위가 커서 4단계로 쪼갰다: 1B-1(데이터 구조+읽기전용) → 1B-2(Level1+공통40점 편집) → 1B-3(직무60점+임계값·하루상한 편집) → 1B-4(버전이력·복구·가상후보 미리보기). 이 문서는 **1B-1만** 다룬다.

사용자 결정: 이 화면(과 이후 편집 기능)은 ADMIN 전용이 아니라 **기존 인재검색 접근 권한(`accounts.system_role==='ADMIN' || accounts.can_use_talent_search`)과 동일한 기준**으로 연다 — "실제 담당자에게만 열어줄 것"이라 굳이 더 좁힐 필요가 없다는 판단.

## 범위

**이번(1B-1)에 포함**:
- 회사 전체에 적용되는 채점 정책을 저장하는 새 테이블, 원본 명세서 초기값으로 시드
- "인재검색" 화면에 서브탭(대시보드 / 기준 관리센터) 추가
- 기준 관리센터: 지금 적용 중인 정책값을 그룹별 카드로 **읽기 전용** 표시 + 버전 번호 표시
- 서버 사이드 권한 검사 헬퍼(`requireTalentSearchAccess`) 신설 — Phase 1A 이후 계속 프론트엔드 전용이었던 권한 검사를 이번에 처음으로 서버(API)에도 적용

**이번에 포함 안 함(다음 슬라이스)**:
- 값 수정 UI, 합계(40/60) 실시간 검증 — 1B-2/1B-3
- 초안 저장/적용/버전 전환/이전 버전 복구 UI — 1B-4
- 가상 후보 3명에 변경 영향 미리보기 — 1B-4
- 근거 충족도 계산구간, 목록 1차 선별 규칙, 품질검수 표본 크기 등 세부 설정 — 실제로 그 기능(이력서 평가 엔진)이 생기는 Phase 2 이후에 맞춰 추가

## 데이터 구조

```sql
CREATE TABLE talent_search_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no integer NOT NULL,
  level1_rules jsonb NOT NULL,
  common_fit_weights jsonb NOT NULL,
  evidence_coefficients jsonb NOT NULL,
  job_fit_default_weights jsonb NOT NULL,
  rounding_rule jsonb NOT NULL,
  thresholds jsonb NOT NULL,
  sort_tiebreak_rules jsonb NOT NULL,
  daily_recommend_cap_default integer NOT NULL DEFAULT 50,
  daily_recommend_cap_absolute_max integer NOT NULL DEFAULT 50,
  data_retention_months integer NOT NULL DEFAULT 12,
  status text NOT NULL DEFAULT 'draft', -- draft | active | superseded
  change_reason text,
  created_by uuid REFERENCES accounts(id),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_no)
);
```

`talent_search_projects`(Phase 1A)와 달리 이 테이블은 **프로젝트와 무관한 회사 전체 공용 설정**이라 `project_id` 컬럼이 없다. `status`는 `okrs.status`와 같은 컨벤션으로 DB CHECK 제약 없이 앱 레벨에서만 관리한다(1B-4에서 draft/active/superseded 전환 로직이 생기기 전까지, 이번엔 시드 행 하나만 바로 `active`로 넣는다).

### 시드 값 (원본 명세서 그대로)

```sql
INSERT INTO talent_search_policy_versions (
  version_no, level1_rules, common_fit_weights, evidence_coefficients,
  job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
  daily_recommend_cap_default, daily_recommend_cap_absolute_max,
  data_retention_months, status, change_reason, applied_at
) VALUES (
  1,
  '{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},
    "shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,
      "exceptions":["인턴","계약만료","프로젝트완료","폐업","구조조정","관계사이동"]},
    "careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}'::jsonb,
  '[{"key":"ownership","label":"목표완결성·오너십","points":12},
    {"key":"resultOriented","label":"성과·수치 중심 사고","points":8},
    {"key":"problemSolving","label":"문제해결·재발방지","points":8},
    {"key":"execution","label":"실행력·운영 정확성","points":7},
    {"key":"collaboration","label":"협업·조율 능력","points":5}]'::jsonb,
  '{"none":0.5,"weak":0.65,"partial":0.8,"clear":1.0}'::jsonb,
  '[{"key":"coreExperience","label":"핵심 업무 직접 경험","points":30},
    {"key":"seniorityScope","label":"직급·독립 수행 범위","points":10},
    {"key":"similarResults","label":"유사 성과·결과","points":8},
    {"key":"toolsPortfolio","label":"도구·자격·포트폴리오","points":6},
    {"key":"industryFit","label":"산업·사업환경 적합성","points":4},
    {"key":"niceToHave","label":"우대조건","points":2}]'::jsonb,
  '{"unit":0.5,"tieBreak":"roundUp"}'::jsonb,
  '{"totalScoreMin":70,"jobFitScoreMin":42,"minMeaningfulEvidenceCount":2}'::jsonb,
  '["totalScoreDesc","jobFitScoreDesc","evidenceCoverageDesc","resumeUpdatedAtDesc","candidateIdAsc"]'::jsonb,
  50, 50, 12, 'active', '초기값 (원본 명세서 기준값 그대로 시드)', now()
);
```

공통 40점(12+8+8+7+5=40), 직무 60점(30+10+8+6+4+2=60) 모두 원본 문서 배점 합과 일치 — 실제 편집 시 합계 검증은 1B-2/1B-3에서 코드로 구현하지만, 이 시드 값 자체도 이미 맞아야 한다.

## 권한 — 서버 사이드 검사 신설

Phase 1A 최종 검토에서 지적된 대로, 지금까지 "인재검색" 접근 제한은 **프론트엔드(사이드바 숨김)뿐**이고 서버 API는 검사하지 않았다(Phase 1A 시점엔 실제 데이터가 없어 위험이 없었음). 이번에 실제 정책 데이터를 노출하는 첫 API가 생기므로, 다음 헬퍼를 신설해 여기서부터 서버 검사를 시작한다.

```js
// handlers/_lib/accountAuth.js에 추가
export async function requireTalentSearchAccess(req, res) {
  const account = await requireAuth(req, res);
  if (!account) return null;
  if (account.system_role !== 'ADMIN' && !account.can_use_talent_search) {
    res.status(403).json({ error: '인재검색 권한이 없어요' });
    return null;
  }
  return account;
}
```

`requireRole(req, res, ['ADMIN'])`과 같은 자리에서 쓰는 대체 함수이되, "ADMIN이거나 플래그가 켜진 사람"이라는 OR 조건이라 기존 `requireRole`(배열 안에 값이 있는지만 봄)로는 표현이 안 돼서 별도 함수로 뺀다. 앞으로 인재검색 관련 모든 API(Phase 1B~5)는 `requireRole` 대신 이 함수를 쓴다.

## 화면

"인재검색" 뷰 안에 서브탭 두 개를 추가한다(🎯목표 탭의 서브탭과 같은 패턴):

- **대시보드** (Phase 1A에서 만든 것, 그대로 유지)
- **기준 관리센터** (신규)

기준 관리센터는 상단에 "현재 적용 중 · 버전 1"을 표시하고, 아래 그룹별 카드:

| 카드 | 표시 내용 |
|---|---|
| 1차 필터(Level 1) 기준 | 이력서 업데이트 90일/180일 기준, 단기근속 기준(12개월/5년/2회, 예외사유 목록), 경력공백 기준(6개월/12개월) |
| 공통 적합도 40점 | 5개 항목명 + 배점 (합계 40 표시) |
| 직무 적합도 60점(기본) | 6개 상위영역명 + 배점 (합계 60 표시) |
| 근거수준별 점수 | 없음 50% · 약함 65% · 부분 80% · 명확 100% |
| 추천 임계값 | 총점 70점 이상, 직무점수 42점 이상, 의미있는 근거 2개 이상 |
| 하루 추천 상한 | 기본 50명 (절대 상한 50명) |

전부 읽기 전용 — "수정" 버튼은 이번 단계에서 아직 안 보이거나, 보이되 눌러도 "다음 단계에서 추가돼요" 안내만 뜬다(어느 쪽이든 상관없음, 구현 시 자연스러운 쪽으로).

## API

`GET /api/talent-search-policy` — 현재 `status='active'`인 정책 버전 하나를 camelCase로 변환해 반환. `requireTalentSearchAccess`로 보호.

```
{
  id, versionNo, level1Rules, commonFitWeights, evidenceCoefficients,
  jobFitDefaultWeights, roundingRule, thresholds, sortTiebreakRules,
  dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, dataRetentionMonths,
  status, changeReason, appliedAt, createdAt
}
```

## 리스크 / 후속 확인 사항

- `requireTalentSearchAccess` 도입은 Phase 1A 최종 검토에서 나온 "서버 사이드 검사가 없다"는 지적을 해소하는 첫걸음이지만, 아직 Phase 1A의 기존 화면(대시보드)이 쓰는 API는 없으므로(하드코딩된 예시 카드라 API 자체가 없음) 소급 적용할 대상이 없다 — 이 함수는 이번에 처음 만드는 `/api/talent-search-policy`부터 바로 적용된다.
- 시드 SQL의 JSONB 값은 전부 원본 명세서 숫자를 그대로 옮긴 것 — 편집 UI가 생기기 전까지는 이 값을 바꾸려면 SQL을 직접 실행해야 한다(1B-2/1B-3에서 해소).
