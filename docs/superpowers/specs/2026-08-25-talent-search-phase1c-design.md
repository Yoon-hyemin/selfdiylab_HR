# 인재검색 Phase 1C — 새 인재검색 입력 화면

- 작성일: 2026-08-25
- 선행 문서: `docs/superpowers/specs/2026-08-19-talent-search-automation-design.md`(전체 아키텍처), `인재검색_자동화_마스터프롬프트_원본.md` 3장(사용자 입력 정보), 12.3절 B(새 인재검색 화면 명세)
- 관련 기존 파일: `sql/015_talent_search.sql`(Phase 1A, `talent_search_projects` 빈 테이블 스키마), `handlers/_lib/accountAuth.js`의 `requireTalentSearchAccess`, `index.html`의 `renderTalentSearchDashboard()`

## 배경

Phase 1B(기준 관리센터)가 전부 끝났다. 로드맵상 다음은 1C — "검색 프로젝트를 실제로 만드는" 첫 화면이다. `talent_search_projects` 테이블은 Phase 1A 때 미리 컬럼을 설계해뒀지만(주석: "스키마를 먼저 확정해두면 이후 Phase에서 이 테이블에 대한 ALTER 없이 바로 API를 붙일 수 있다") 실제로 확인해보니 원본 명세 3.1절의 "기본 화면 입력" 중 **키워드 5종(포함/OR/정확일치/제외/우대)이 빠져 있다** — 이번에 컬럼을 보강한다.

원본 명세에서 자연어 인재상 설명을 구조화하는 건 "로컬 모델"(Phase 2, 아직 없음)의 일이다. Phase 1은 "실제 AI 연결 없이 화면 흐름만 검증"하는 단계이므로, 1C의 "추가질문 최대 3개 시뮬레이션"은 **AI가 아니라 고정 규칙 기반**으로 흉내만 낸다.

사용자 결정(이번 세션에서 확인):
- 폼 제출 시 **실제로 DB에 저장**한다(1A처럼 화면만 만들고 저장 안 하는 쪽이 아니라).
- 저장 후 "이 조건으로 검색 시작"(1D 검색기준 확인·승인, 1E 검색 진행)은 이번 범위에 넣지 않는다.
- 대시보드의 기존 "예시" 카드 2개는 그대로 두고, 새로 만든 프로젝트를 대시보드 카드 목록에 실제로 연결하는 것도 이번 범위에 넣지 않는다(스코프 확장 방지).

## 범위

**이번(1C)에 포함**:
- `talent_search_projects`에 키워드 5종 컬럼(`keywords` jsonb) + 시뮬레이션 추가질문 답변 저장용 컬럼(`clarification_notes` jsonb) 추가
- 새 테이블 `talent_search_job_templates`(직무 템플릿 저장/불러오기)
- "인재검색 → 대시보드" 서브탭에 "+ 새 인재검색" 버튼 → 입력 화면
- 입력 화면: 기본 필드 + 상세조건(선택, 접힘) + 키워드 태그 입력 + 플랫폼·목표인원 + 템플릿 불러오기/저장
- 제출 시 규칙 기반 "추가질문 시뮬레이션"(최대 3개, 조건 충족 시에만 등장)
- `POST /api/talent-search-projects`, `POST /api/talent-search-job-templates`, `GET /api/talent-search-job-templates`

**이번에 포함 안 함(다음 슬라이스)**:
- 검색기준 확인·승인 화면(1D), 검색 진행 시뮬레이션(1E)
- 만든 프로젝트를 대시보드 카드 목록에 실제로 표시(대시보드 통합)
- 만든 프로젝트 목록 조회/수정/삭제 화면 — 이번엔 "만들기"까지만이라 `GET /api/talent-search-projects`(목록)도 아직 안 만든다. DB에 저장된 것 확인은 SQL로 직접 검증.
- 자연어 설명의 실제 AI 구조화(로컬 모델 연결) — Phase 2 이후
- 직무 템플릿 관리 화면(목록 보기/이름 변경/삭제) — 이번엔 저장과 불러오기(드롭다운)만

## 데이터 구조

새 마이그레이션 `sql/017_talent_search_project_input.sql`:

```sql
-- talent_search_projects: Phase 1A 시드 스키마에 키워드 5종이 빠져있던 걸
-- 보강. work_conditions(이미 있음, jsonb)는 "근무지역 외 필수 근무조건"뿐
-- 아니라 3.1절의 선택적 상세조건(입사가능시점/연봉/재택여부/필수자격/
-- 피해야 할 경력유형)까지 자유 키로 담는 용도로 그대로 재사용한다.
ALTER TABLE talent_search_projects
  ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '{"include":[],"or":[],"exact":[],"exclude":[],"preferred":[]}',
  ADD COLUMN IF NOT EXISTS clarification_notes jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS talent_search_job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  criteria jsonb NOT NULL,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`criteria`는 프로젝트 입력 폼의 전체 필드(title 제외한 조건 필드 전부)를 그대로 담는 스냅샷이다. 템플릿을 나중에 고쳐도 과거에 이미 만든 검색 프로젝트에는 영향이 없다(원본 명세 113행 요구사항) — 스냅샷 저장이라 자연히 만족된다. 반대로 템플릿을 불러와 새 프로젝트를 만든 뒤 그 프로젝트 내용을 고쳐도 템플릿 원본은 안 바뀐다(같은 이유).

## 규칙 기반 "추가질문" 시뮬레이션

서버 로직 없이 **클라이언트에서만** 판단한다(순수 UI 시뮬레이션). 제출 버튼을 누르면 아래 조건을 순서대로 검사해서, 해당하는 질문만 최대 3개까지 모달로 보여준다. 하나도 해당 안 하면 모달 없이 그대로 저장된다.

| 조건 | 질문 |
|---|---|
| 자연어 설명이 30자 미만 | "이 직무에서 반드시 확인해야 할 과거 성과나 경험이 있다면 설명해주세요" |
| 포함 키워드가 비어있음 | "반드시 포함되어야 할 키워드가 있다면 알려주세요" |
| 제외 키워드가 비어있음 | "반드시 피해야 할 경력유형이나 업무환경이 있나요?" |

답변(빈 답변 포함, 건너뛰기 가능)은 `{question, answer}` 배열로 `clarification_notes`에 그대로 저장한다 — 지금은 화면에 다시 보여주는 곳이 없지만(1D에서 "찾는 사람 요약"에 활용 예정), 값 자체는 이번에 확보해둔다.

## API

### `POST /api/talent-search-projects`

`requireTalentSearchAccess`로 보호. 요청 바디(camelCase) → `status='draft'`로 INSERT.

```
{ title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?,
  employmentType, headcount, location?, workConditions? (object),
  naturalLanguageBrief?, keywords: {include,or,exact,exclude,preferred} (각 string[]),
  targetRecommendCount, platforms: string[] (사람인/잡코리아/리멤버/원티드 중, 1개 이상),
  clarificationNotes?: [{question, answer}] }
```

검증: `title`/`roleTitle` 필수(trim), `employmentType` 필수, `headcount` 1 이상 정수, `targetRecommendCount` 1 이상 정수, `platforms` 최소 1개(허용값 4개 중에서만), `keywords`의 각 항목은 문자열 배열이어야 함(없으면 빈 배열로 처리). 상세조건(`workConditions` 내부 필드), `location`, `seniorityLevel`, 경력범위, `naturalLanguageBrief`는 선택 — 비워도 감점/거부하지 않는다(원본 명세 105행 원칙).

응답: `201 { id }`.

### `POST /api/talent-search-job-templates`

`requireTalentSearchAccess`로 보호. `{ name, criteria }` → `201 { id }`. `name` 필수(trim), `criteria`는 그대로 jsonb 저장(서버는 구조를 깊게 검증하지 않음 — 프론트가 만든 스냅샷을 신뢰).

### `GET /api/talent-search-job-templates`

`requireTalentSearchAccess`로 보호. 최신순 전체 목록 반환(내부 소규모 팀 공용 도구라 만든 사람 무관하게 전부 보임 — 기준 관리센터 정책과 같은 공유 모델). `{ templates: [{ id, name, criteria, createdAt }] }`.

## 화면

"인재검색 → 대시보드" 서브탭 상단, 기존 "아직 실제 검색 프로젝트를 만드는 기능은 없어요" 안내 문구 위(또는 옆)에 **"+ 새 인재검색" 버튼**을 추가한다. 누르면 같은 대시보드 서브탭 안에서 카드 목록 대신 입력 폼으로 전환된다(뒤로가기로 카드 목록 복귀).

입력 폼 구성(원본 명세 3.1절 순서 그대로):
1. 상단: "직무 템플릿 불러오기" 드롭다운(선택 시 아래 필드 전부 자동 채움, `GET` 목록 사용)
2. 기본 필드: 검색 프로젝트명, 채용 직무/포지션명, 직급/역할수준, 희망 경력범위(최소~최대), 고용형태, 채용인원, 근무지역
3. 찾고 싶은 사람 자연어 설명(긴 텍스트 영역, 가장 크게)
4. 키워드 태그 입력 5종(포함/OR/정확일치/제외/우대) — 각각 태그칩 입력
5. 총 적합 추천 목표 인원, 검색할 플랫폼 선택(체크박스 4개: 사람인/잡코리아/리멤버/원티드)
6. "상세조건"(접힘, 선택): 희망 입사가능 시점, 연봉·보상 범위, 출근/재택/출장 조건, 필수 자격·언어·포트폴리오, 반드시 피해야 할 업무환경/경력유형 — 전부 `workConditions` jsonb 안에 자유 키로 저장
7. 하단: "이 조건을 직무 템플릿으로도 저장" 체크박스 + 템플릿 이름 입력(체크 시 필수) + "검색기준 만들기" 제출 버튼

제출 흐름: 클라이언트 유효성 검사 → 규칙 기반 추가질문 시뮬레이션(해당하면 모달) → `POST /api/talent-search-projects` → (템플릿 저장 체크됐으면) `POST /api/talent-search-job-templates` → 성공 화면("검색 프로젝트가 만들어졌어요 — 검색기준 확인·승인 화면은 다음 단계에서 만들 예정이에요" 안내 후 카드 목록으로 복귀).

## 리스크 / 후속 확인 사항

- `workConditions`를 자유 jsonb로 두면 프론트와 백엔드가 내부 키 이름(예: `expectedStartDate`, `salaryRange`)에 대해 별도 계약을 맞춰야 한다 — 서버는 구조를 검증하지 않고 그대로 저장/반환만 하므로, 키 이름은 구현 계획 문서에서 한 번에 확정하고 프론트 코드에서 그 이름만 쓰도록 한다.
- `platforms` 허용값(사람인/잡코리아/리멤버/원티드)은 지금 이 핸들러에만 하드코딩된다 — Phase 3/4에서 플랫폼별 커넥터가 실제로 생기면 그때 이 목록의 출처를 다시 검토할 것(지금은 이 4개가 원본 명세에 고정돼 있어 문제 없음).
- 대시보드 카드 연동을 미뤄서, 이번 단계가 끝나면 "만들어진 프로젝트가 어디서도 안 보이는" 상태가 남는다 — 사용자에게 확인용으로 SQL 조회 결과를 보여주는 방식으로 검증하고, 실제 화면 연동은 다음 슬라이스(1D 또는 별도 대시보드 통합)로 명시적으로 넘긴다.
