# 인재검색 Phase 1D-2 — 플랫폼별 검색어 생성 + 승인 액션

- 작성일: 2026-08-26
- 선행 문서: `docs/superpowers/specs/2026-08-26-talent-search-phase1d1-design.md`(1D-1, 목록/상세 조회+검토화면), `인재검색_자동화_마스터프롬프트_원본.md` 3.3절("기준 승인 화면" 목록), 906행(1D 항목)
- 관련 기존 파일: `handlers/talent-search-projects/[id].js`(상세 GET), `handlers/_lib/talentSearchPolicy.js`(`getActivePolicy`/`policy_out`/`listPolicyVersions`), `handlers/talent-search-policy/versions/index.js`(버전 이력 GET, 전체 필드 포함), `index.html`의 `openTalentSearchProjectDetail()`

## 배경

1D-1에서 검토 화면(요약, 필수/핵심/우대/정확일치/제외 조건, 상세조건, 지금 적용 중인 채점 기준)까지 만들었다. 화면엔 이미 "이 프로젝트를 승인하는 시점의 버전으로 고정됩니다 — 승인 기능은 다음 단계에서 추가돼요"라는 안내가 있었는데, 이번(1D-2)이 그 자리를 실제로 채운다.

원본 명세 3.3절의 "플랫폼별 검색어"·13장 로드맵의 "직무기준과 검색어 생성"은 명시적으로 **Phase 2(로컬 모델)의 일**이다. 지금은 로컬 모델이 없으므로, 이번 슬라이스는 이미 1C에서 모은 키워드 5종을 단순한 규칙(공백=AND, `|`=OR, 따옴표=정확일치, `-`=제외)으로 이어붙인 검색식을 만드는 것까지만 한다 — 플랫폼마다 실제 검색창 문법이 다를 수 있지만(잡코리아/사람인/리멤버/원티드 각각 다른 문법을 쓸 수 있음), 그 차이는 실제 어댑터가 생기는 Phase 3/4에서나 확인 가능하다. 그래서 이번엔 **4개 플랫폼에 전부 같은 검색식을 보여주고, 그렇다는 걸 화면에 정직하게 안내**한다.

## 범위

**이번(1D-2)에 포함**:
- 검토 화면에 "플랫폼별 검색어" 섹션 추가 — 새 API 없음, 이미 화면이 들고 있는 `keywords`로 클라이언트에서 계산
- `PATCH /api/talent-search-projects/:id/approve` — 승인 액션. `status`를 `draft`→`approved`로 바꾸고, 그 시점의 활성 채점 기준 버전 id를 프로젝트에 저장(스냅샷)
- 새 컬럼 `talent_search_projects.policy_version_id`(nullable uuid, `talent_search_policy_versions(id)` 참조)
- 검토 화면: `status==='approved'`인 프로젝트는 "지금 적용 중인" 기준이 아니라 **승인 당시 고정된 버전**을 보여주고(이미 있는 `GET /api/talent-search-policy/versions`가 최근 50개 버전의 전체 필드를 다 내려주므로 새 조회 엔드포인트 없이 그 응답에서 찾아 쓴다), "이 조건으로 검색" 버튼 대신 "승인됨" 배지를 보여준다

**이번에 포함 안 함(다음 슬라이스 이후)**:
- 실제 검색 실행(1E) — 승인은 상태 전환일 뿐, 이 버튼을 눌러도 실제 플랫폼 검색은 시작되지 않는다(원본 명세 154행 원칙 그대로)
- 프로젝트 수정/삭제, 승인 취소(반려)
- 플랫폼별로 실제로 다른 검색 문법 적용 — Phase 3/4에서 어댑터가 생길 때
- 자동 확장된 유사어/직무 동의어 — Phase 2

## 플랫폼별 검색어 생성 (클라이언트 계산)

기존 검토 화면(`openTalentSearchProjectDetail`)이 이미 들고 있는 `project.keywords`로 계산한다. 규칙:

- 필수(`include`): 공백으로 이어붙임(AND)
- OR(`or`): `(키워드1|키워드2)` 형태로 괄호와 `|`
- 정확일치(`exact`): 각 문구를 큰따옴표로 감쌈
- 제외(`exclude`): 각 키워드 앞에 `-`

넷을 공백으로 이어붙여 하나의 검색식 문자열을 만들고, `project.platforms`에 선택된 플랫폼마다 같은 문자열을 보여준다. 다섯 부분이 전부 비어있으면(포함/OR/정확일치/제외 키워드를 하나도 안 넣은 경우) "검색어를 만들 수 없어요 — 필수 조건이나 키워드가 있어야 해요"라고 안내한다. 섹션 상단에 "지금은 플랫폼마다 검색 문법 차이 없이 같은 규칙으로 만들어져요 — 실제 플랫폼 연동(다음 로드맵의 3~4단계)에서 플랫폼별 문법에 맞게 다듬을 예정이에요"라는 안내 문구를 둔다.

## 데이터 구조

새 마이그레이션 `sql/018_talent_search_project_approval.sql`:

```sql
ALTER TABLE talent_search_projects
  ADD COLUMN IF NOT EXISTS policy_version_id uuid REFERENCES talent_search_policy_versions(id);
```

`policy_version_id`는 승인 전엔 `NULL`이고, 승인 시점에 그때 활성 버전의 `id`로 채워진다. 이후 정책이 새 버전으로 바뀌어도 이 값은 안 바뀐다 — "승인 당시 기준"을 영구히 가리키는 스냅샷.

## API

### `PATCH /api/talent-search-projects/:id/approve`

`requireTalentSearchAccess`로 보호. 요청 바디 없음(빈 객체).

- 대상 프로젝트가 없으면 `404`
- `status !== 'draft'`이면 `400 {"error":"이미 승인됐거나 승인할 수 없는 상태예요"}`(재승인 방지)
- 지금 활성인 정책 버전이 없으면(이론상 불가능하지만) `409 {"error":"적용 중인 채점 기준이 없어요"}`
- 성공 시 `status='approved'`, `policy_version_id=<활성 버전 id>`, `updated_at=now()`로 UPDATE하고, 상세 조회와 같은 모양(`project_detail_out`에 `policyVersionId` 필드 추가)으로 `200` 응답

## 화면

검토 화면(`openTalentSearchProjectDetail`)의 "지금 적용 중인 채점 기준" 섹션을 다음처럼 바꾼다:

- `project.status === 'draft'`: 지금과 동일 — `GET /api/talent-search-policy`(활성 버전)를 보여주고, 안내 문구 아래에 **"이 조건으로 검색" 버튼**을 추가한다. 누르면 확인창(confirm) 후 `PATCH .../approve` 호출 → 성공 시 화면을 그 프로젝트로 다시 불러온다(승인된 상태로 재렌더링).
- `project.status === 'approved'`: `GET /api/talent-search-policy/versions`를 불러와 `project.policyVersionId`와 일치하는 항목을 찾아 그 값으로 정책 카드를 그린다(못 찾으면 — 극히 드문 50개 초과 사례 — "승인 당시 버전을 더 이상 찾을 수 없어요" 안내만 표시). 섹션 제목을 "승인 당시 채점 기준 · 버전 N(고정됨)"으로 바꾸고, 버튼 대신 배지 "✅ 승인됨"을 보여준다.

대시보드 카드의 상태 배지(`TS_STATUS_LABEL`)에 `approved: '승인됨'`을 추가한다.

## 리스크 / 후속 확인 사항

- `GET /api/talent-search-policy/versions`가 최근 50개까지만 반환하므로, 정책 버전이 그사이 50번 넘게 바뀌면 오래전에 승인된 프로젝트의 스냅샷을 이 화면에서 못 찾을 수 있다 — 내부 소규모 도구에서 극히 낮은 확률이라 이번엔 감수하고, 그런 경우 안내 문구만 보여준다(에러로 화면이 깨지지 않게).
- 승인 후 프로젝트를 다시 수정할 방법이 없다(수정 기능 자체가 아직 없음) — 승인을 취소하고 싶으면 지금은 방법이 없다는 뜻이라, 사용자 확인 없이 실수로 누르지 않도록 승인 버튼에 confirm 확인창을 반드시 둔다.
