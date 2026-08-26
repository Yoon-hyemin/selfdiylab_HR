# 인재검색 Phase 1E-1 — 가상 후보 생성 + 검색 진행 목록 화면

- 작성일: 2026-08-26
- 선행 문서: `docs/superpowers/specs/2026-08-26-talent-search-phase1d2-design.md`(1D-2, 승인 액션), `인재검색_자동화_마스터프롬프트_원본.md` 907행(1E 항목), 4장(목록 단계 1차 선별 기준), 12.3절 A(검색 프로젝트 대시보드)
- 관련 기존 파일: `index.html`의 `VIRTUAL_CANDIDATES`/`evaluateLevel1`/`scoreItemGroup`/`simulateCandidate`(1B-4c 채점 엔진), `handlers/talent-search-projects/[id]/approve.js`, `handlers/talent-search-policy/versions/index.js`

## 배경

1D-2까지 끝나서 프로젝트를 승인(`status='approved'`, 채점 기준 버전 고정)할 수 있게 됐지만, 승인 후에는 화면에 더 할 일이 없었다("✅ 승인됨" 배지만 뜨고 끝). 로드맵상 다음(1E)은 "검색 진행 시뮬레이션"인데, 범위가 매우 커서(가상 후보 100명+, 목록/상세/평가/추천/제외/중복, 일시정지·재개, 체크포인트, 배치 시뮬레이션, 플랫폼 순서 제안, 소진 보고서) 여러 슬라이스로 쪼갠다. 이 문서는 **1E-1(가상 후보 생성 + 목록 화면)만** 다룬다.

원본 명세는 이 단계를 실제 채용 플랫폼에서 이력서를 긁어와 평가하는 걸로 그리지만, Phase 1 전체가 "실제 플랫폼 접근 없이 화면 흐름을 가상 데이터로 검증"하는 단계이므로(Phase 0 원칙), 이번에도 실제 플랫폼 연동 없이 **서버가 무작위 특성을 가진 가상 후보를 만들어 DB에 저장**하고, 채점은 이미 1B-4c에서 만든 원본 명세 채점 공식(Level1 판정 + 근거계수 적용 가중점수)을 그대로 재사용한다.

## 범위

**이번(1E-1)에 포함**:
- 새 테이블 `talent_search_candidates` — 프로젝트별 가상 후보 원본 데이터(채점에 필요한 raw 속성만, 점수 자체는 저장 안 함)
- `POST /api/talent-search-projects/:id/candidates` — 가상 후보 배치 생성(재호출 시 기존 후보를 지우고 새로 생성 = "다시 생성"). `status==='approved'`인 프로젝트에만 허용
- `GET /api/talent-search-projects/:id/candidates` — 생성된 후보 목록 조회(raw 속성만)
- 승인된 프로젝트의 검토 화면에 "검색 진행 보기" 버튼 추가(승인 안 된 프로젝트엔 안 보임)
- 새 화면: 후보가 없으면 "가상 후보 생성하기" 버튼, 있으면 목록(가상 후보명/플랫폼/Level1 판정/총점/판정배지) + 요약 카운트(총 N명, 추천/확인필요/제외 각각 몇 명) + "다시 생성" 버튼
- 판정(추천/확인필요/제외)은 **저장하지 않고 화면에서 매번 계산**한다 — 프로젝트가 승인 시점에 고정해 둔 채점 기준 버전(`policyVersionId`)으로 계산해서, 이후 기준 관리센터에서 정책이 바뀌어도 이 화면 결과는 안 바뀐다(1D-2의 "승인 당시 기준으로 고정" 원칙을 그대로 이어받음)

**이번에 포함 안 함(1E-2 이후)**:
- 후보 상세보기(원문 이력서 링크 등 — 애초에 이번 후보는 가상이라 원문이 없음), 수동 평가·"정보 부족"·"중복" 표시(사람이 열어봐야 판단 가능한 상태라 상세보기가 먼저 있어야 함)
- 일시정지·안전종료·이어서 검색, 체크포인트 저장/복구
- 검색배치 시뮬레이션(하루 단위 진행), 플랫폼 순서 제안, 검색범위·인재풀 소진 보고서
- 대시보드 카드의 "오늘 추천"/"누적 추천" 숫자를 실제 값으로 연동 — 대시보드는 여러 프로젝트를 한 번에 보여줘야 해서 집계 방식을 따로 설계해야 함, 이번엔 프로젝트 개별 화면에서만 카운트를 보여준다
- 실제 채용 플랫폼 접근

## 데이터 구조

새 테이블(마이그레이션 `sql/019_talent_search_candidates.sql`):

```sql
CREATE TABLE IF NOT EXISTS talent_search_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  resume_age_days integer NOT NULL,
  short_tenure_count integer NOT NULL,
  gap_months integer NOT NULL,
  evidence_pattern jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- `name`은 실제 사람처럼 보이지 않도록 `가상후보-001` 형식의 중립적인 라벨로 서버가 생성한다(이 앱이 실제 구성원 개인정보도 다루는 시스템이라, 가짜 후보에 그럴듯한 실명을 붙이면 실제 데이터와 혼동될 위험이 있다 — 의도적으로 피한다).
- `platform`은 그 프로젝트의 `platforms` 배열 중 하나를 무작위로 배정(표시용).
- `resume_age_days`/`short_tenure_count`/`gap_months`/`evidence_pattern`은 1B-4c의 `VIRTUAL_CANDIDATES` 항목과 정확히 같은 모양(`evidence_pattern`은 `['명확','부분',...]` 같은 5개 길이 배열) — 그래서 채점 시 `index.html`의 기존 `evaluateLevel1`/`scoreItemGroup`/`simulateCandidate` 함수를 그대로, 수정 없이 재사용할 수 있다.
- 점수·판정(Level1 상태, 공통/직무 점수, 총점, 추천 여부)은 컬럼으로 저장하지 않는다 — 이 프로젝트의 "서버는 원본만, 계산은 클라이언트" 원칙 그대로.

## 생성 규칙 (서버, POST 핸들러)

- 인원수: `max(100, targetRecommendCount * 3)`, 최대 300명으로 상한(무한정 커지는 것 방지). "최소 100명"이라는 원본 명세 요구를 만족하면서, 목표인원이 큰 프로젝트는 검토할 후보 풀도 비례해서 커지게 한다.
- 각 후보의 4개 raw 속성은 무작위로 생성하되, 순수 균등분포 대신 약간의 편향을 준다(전부 최악이면 추천자가 0명이 되어 화면이 재미없고, 전부 최고면 필터링 의미가 없다) — `resumeAgeDays` 0~250일, `shortTenureCount` 0~4회, `gapMonths` 0~20개월을 균등 난수로 뽑고, `evidencePattern`(길이 5)은 `['없음','약함','부분','명확']` 중에서 `약함`·`부분`에 가중치를 더 준 분포로 5개를 뽑는다(가운데가 두꺼운 분포로, 지나치게 극단적이지 않은 채점 결과가 나오게 함).
- 재호출(POST를 다시 부름) 시 그 프로젝트의 기존 `talent_search_candidates` 행을 전부 지우고 새로 생성한다 — "다시 생성" 버튼의 동작.

## API

### `POST /api/talent-search-projects/:id/candidates`

`requireTalentSearchAccess`로 보호. 대상 프로젝트가 없으면 `404`. `status !== 'approved'`면 `400 {"error":"승인된 프로젝트만 가상 후보를 생성할 수 있어요"}`. 성공 시 기존 후보 삭제 후 새로 생성하고 `201 { candidates: [...] }`(생성된 전체 목록, GET과 같은 모양).

### `GET /api/talent-search-projects/:id/candidates`

`requireTalentSearchAccess`로 보호. `200 { candidates: [{ id, name, platform, resumeAgeDays, shortTenureCount, gapMonths, evidencePattern, createdAt }] }`(생성 순서, 즉 `created_at` 오름차순). 후보가 없으면 빈 배열.

## 화면

승인된 프로젝트의 검토 화면(`openTalentSearchProjectDetail`)에서 "✅ 승인됨" 배지 옆에 **"검색 진행 보기"** 버튼을 추가한다. 누르면 같은 컨테이너가 새 화면(`openTalentSearchCandidates(projectId)`)으로 바뀐다.

- 후보가 아직 없으면: 안내 문구 + "가상 후보 생성하기" 버튼(누르면 POST 호출 → 성공 시 같은 화면을 후보 목록으로 다시 그림)
- 후보가 있으면:
  - 상단 요약: 총 N명 / 추천 N명 / 확인필요 N명 / 제외 N명(전부 클라이언트에서 그 프로젝트의 고정 채점 기준으로 계산)
  - "다시 생성" 버튼(확인창 필요 — 기존 후보가 전부 사라진다는 걸 알림)
  - 표: 가상후보명 / 플랫폼 / Level1 판정 / 총점 / 판정배지, 총점 내림차순 정렬
- "← 뒤로" 버튼으로 그 프로젝트의 검토 화면으로 돌아간다.

채점 기준은 프로젝트의 `policyVersionId`로 `GET /talent-search-policy/versions`에서 찾는다 — 검토 화면이 이미 이 로직(`versions.find(v=>v.id===project.policyVersionId)`)을 갖고 있으므로 그대로 재사용한다.

## 리스크 / 후속 확인 사항

- 후보 100~300명을 매번 클라이언트에서 채점 계산하는 건 순수 함수 호출 300번 정도라 성능 문제는 없다(1B-4c가 이미 같은 로직을 3명에 대해 쓰고 있고, 항목 개수도 수십 개 수준).
- `talent_search_candidates`에 `project_id ON DELETE CASCADE`를 걸어서, 나중에 프로젝트 삭제 기능이 생기면 후보도 같이 정리되게 해뒀다(지금은 프로젝트 삭제 기능 자체가 없음).
- "다시 생성"이 매번 완전히 새 무작위 배치를 만들기 때문에, 화면을 새로고침할 때마다 결과가 달라 보일 수 있다는 걸 사용자가 헷갈리지 않도록 화면에 "가상 시뮬레이션이라 다시 생성할 때마다 결과가 달라져요"라는 안내를 둔다.
