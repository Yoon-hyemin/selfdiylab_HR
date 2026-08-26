# 인재검색 Phase 1D-1 — 검색 프로젝트 목록/상세 조회 + 대시보드 연동 + 검토 화면

- 작성일: 2026-08-26
- 선행 문서: `docs/superpowers/specs/2026-08-25-talent-search-phase1c-design.md`(1C, 프로젝트 생성), `인재검색_자동화_마스터프롬프트_원본.md` 3.3절("기준 승인 화면" 목록), 12.3절 A/C(대시보드·기준 확인·승인 화면 명세), 906행(1D 항목)
- 관련 기존 파일: `sql/015_talent_search.sql`+`sql/017_talent_search_project_input.sql`(`talent_search_projects` 전체 스키마), `handlers/talent-search-projects/index.js`(POST만 있음), `handlers/_lib/accountAuth.js`의 `requireTalentSearchAccess`, `index.html`의 `renderTalentSearchDashboard()`

## 배경

Phase 1C에서 검색 프로젝트를 실제로 만들 수 있게 됐지만, 만든 프로젝트를 다시 볼 방법이 없었다(GET 엔드포인트 없음, 대시보드는 여전히 "예시" 배지 붙은 고정 카드 2개 — Phase 1A부터 계속 미뤄온 상태). 로드맵상 다음(1D)은 "검색기준 확인·승인" 화면인데, 범위가 커서 두 슬라이스로 쪼갰다:

- **1D-1(이 문서)**: 목록/상세 조회 + 대시보드 실제 데이터 연동 + 읽기 전용 검토 화면
- **1D-2(다음)**: 플랫폼별 검색어 생성(규칙 기반), "이 조건으로 검색" 승인 액션

원본 명세 3.2절은 자연어를 구조화하는 걸 "로컬 모델"(Phase 2, 아직 없음)의 일로 정의하고, 13장의 로드맵도 "직무기준과 검색어 생성"을 명시적으로 Phase 2 항목으로 못박아뒀다. 그래서 이번 슬라이스는 **이미 1C에서 수집해둔 데이터(키워드 5종, 자연어 설명, 기본 필드)를 그대로 정리해서 보여주는 것**까지만 하고, "자동 확장된 유사어/직무 동의어"나 "직무별로 맞춘 60점 생성" 같은 진짜 AI가 필요한 항목은 이번 범위에 넣지 않는다.

## 범위

**이번(1D-1)에 포함**:
- `GET /api/talent-search-projects` — 목록(요약 필드)
- `GET /api/talent-search-projects/:id` — 상세(전체 필드)
- 대시보드: 고정 예시 카드 2개를 실제 목록으로 교체(비어있으면 안내 문구)
- 카드 클릭 → 읽기 전용 검토 화면: 찾는 사람 요약, 필수/핵심/우대/제외조건(키워드 5종을 그대로 라벨링), 상세조건, 추가질문 답변, **지금 적용 중인 채점 기준**(Level1/공통40점/직무60점/임계값·하루상한 — 기준 관리센터와 같은 데이터를 이 화면에서도 보여줌)

**이번에 포함 안 함(1D-2 또는 그 이후)**:
- "이 조건으로 검색" 승인 버튼, `status` 전환
- 플랫폼별 검색어 생성
- 자동 확장된 유사어/직무 동의어(Phase 2, 로컬 모델 필요)
- 직무별로 커스터마이즈된 60점 생성(Phase 2) — 이번엔 회사 공용 기본 배점을 그대로 보여준다
- 프로젝트 수정/삭제
- 검색 진행(1E), 추천목록(1F)

## API

### `GET /api/talent-search-projects`

`requireTalentSearchAccess`로 보호. 최신순 전체 목록, 요약 필드만(카드 렌더링에 필요한 만큼):

```
{ projects: [{ id, title, roleTitle, seniorityLevel, employmentType, headcount,
                location, targetRecommendCount, dailyRecommendCap, platforms,
                status, createdAt }] }
```

`naturalLanguageBrief`/`keywords`/`workConditions`/`clarificationNotes`처럼 카드에 안 쓰는 무거운 필드는 목록에서 뺀다 — 상세 조회에서만 내려준다.

### `GET /api/talent-search-projects/:id`

`requireTalentSearchAccess`로 보호. 해당 프로젝트의 전체 필드를 camelCase로 반환(1C의 POST가 받는 필드 전부 + `id`/`status`/`createdAt`/`updatedAt`). 없는 id면 `404`.

## 화면

### 대시보드 (`renderTalentSearchDashboard()` 교체)

`GET /api/talent-search-projects`로 실제 목록을 받아 카드로 그린다. 카드 하나당: 제목, 부제(직무·직급·고용형태·지역), 상태 배지(`draft` → "작성중"), "오늘 추천 0/{dailyRecommendCap}"·"누적 추천 0/{targetRecommendCount}"(1E/1F가 없어서 항상 0 — 이미 있는 컬럼 값을 그대로 쓰는 것뿐이라 거짓 정보가 아니다). 목록이 비어있으면 "아직 만든 검색 프로젝트가 없어요 — 위 '+ 새 인재검색'으로 시작해보세요" 안내만 보여준다. "예시" 배지 카드는 완전히 제거한다. 카드를 클릭하면 검토 화면으로 전환한다(같은 컨테이너를 갈아치우는 방식 — 1C의 "새 인재검색" 폼이 이미 이 패턴을 쓰고 있다).

### 검토 화면 (신규)

`GET /api/talent-search-projects/:id`와 `GET /api/talent-search-policy`(이미 있음, 1B-1)를 동시에 불러와서 조합한다.

- 상단: 프로젝트명, 상태 배지, "← 목록으로" 버튼
- **찾는 사람 요약**: 저장된 필드를 템플릿 문장으로 조합(예: "{roleTitle} · {seniorityLevel} · 경력 {experienceMinYears}~{experienceMaxYears}년 · {employmentType} · {headcount}명") + 자연어 설명 원문을 그대로 표시. AI 요약이 아니라 필드를 이어붙인 것임을 화면에 명시하지는 않되(사용자에게는 "요약"이면 충분), 코드/문서상으로는 순수 템플릿 조합이라는 걸 분명히 한다.
- **필수/핵심/우대/제외조건**: `keywords.include`→필수, `keywords.or`→핵심, `keywords.preferred`→우대, `keywords.exclude`→제외로 그대로 매핑해서 태그 칩으로 보여준다(1:1 매핑, 별도 판단 없음).
- **상세조건**: `workConditions`의 5개 키(입사가능시점/연봉/재택여부/필수자격/피해야 할 경력유형)를 라벨과 함께 표시(값 없으면 그 줄 생략).
- **추가질문 답변**: `clarificationNotes`가 있으면 질문-답변 쌍을 리스트로(답변이 빈 문자열이면 "답하지 않음"으로 표시).
- **지금 적용 중인 채점 기준**: `GET /api/talent-search-policy`의 응답을 기준 관리센터와 같은 카드 레이아웃(1차필터/공통40점/직무60점/근거수준/임계값·하루상한)으로 재사용해서 보여준다 — **이 프로젝트에 고정된 버전이 아니라 "지금 활성 버전"을 보여주는 것**이라는 안내 문구를 카드 위에 둔다("이 프로젝트를 승인하는 시점의 버전으로 고정됩니다 — 다음 단계에서 추가돼요"). 실제 버전 고정(스냅샷)은 1D-2가 승인 액션을 만들 때 다룬다.
- 플랫폼: 선택된 플랫폼 목록만 태그로 보여준다(검색어 생성은 1D-2).

## 리스크 / 후속 확인 사항

- 채점 기준 카드를 다시 그리는 로직이 기준 관리센터의 렌더링 코드와 거의 같아진다 — 완전히 똑같이 복붙하지 말고, 공용 렌더 함수로 뽑을지(예: `renderPolicySummaryCards(policy)`) 이번 구현계획에서 판단한다. 최소한 "1차필터/공통40점/직무60점/근거수준/임계값" 5개 그룹 구조와 필드명은 기준 관리센터와 반드시 일치시킨다.
- 대시보드 카드의 "오늘/누적 추천"은 지금 전부 0으로 고정 표시된다 — 1E/1F가 없는 이번 단계에선 정직한 값이지만, 나중에 실제 추천 데이터가 생기면 이 자리를 계산 로직으로 바꿔야 한다는 걸 잊지 않도록 여기 남긴다.
- `talent_search_projects` 목록이 많아지면(가능성 낮음 — 내부 소규모 도구) 정렬/페이지네이션을 나중에 추가할 수 있다 — 이번엔 전체를 최신순으로 반환한다(개수 제한 없음, 프로젝트 규모상 문제 없음).
