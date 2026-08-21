# 인재검색 Phase 1B-4b — 버전 이력 목록 + 이전 버전으로 복구

- 작성일: 2026-08-21
- 선행 문서: `docs/superpowers/specs/2026-08-21-talent-search-phase1b4a-design.md`(초안 상태 도입, 완료), `docs/superpowers/specs/2026-08-19-talent-search-phase1b1-policy-schema-design.md`(정책 스키마)
- 관련 기존 파일: `handlers/_lib/talentSearchPolicy.js`(`getActivePolicy`/`getDraftPolicy`/`saveDraftOverrides`/`applyDraft`/`discardDraft`/`policy_out`), `handlers/audit-log/index.js`(계정→구성원 이름 조인 패턴), `index.html`의 `switchTalentSearchTab()`/`loadAndRenderTalentSearchPolicy()`

## 배경

1B-4a에서 초안(draft) 상태를 도입해서, 지금 `talent_search_policy_versions` 테이블에는 활성(active) 1개 + 초안(draft, 있으면) 1개 + 나머지는 전부 과거(superseded)로 계속 쌓이고 있다. 그런데 지금 화면(기준 관리센터)은 활성 버전과 초안만 보여주고, 과거로 밀려난 버전들은 DB에 쌓이기만 하고 화면에서 전혀 안 보인다 — 몇 번째 버전에서 누가 왜 무엇을 바꿨는지 확인할 방법이 없다. 이번엔 그 과거 버전들을 목록으로 보여주고, 그중 하나를 골라 다시 불러올 수 있게 한다.

## 사용자 결정 (이번 세션 확인)

- **"복구"의 의미**: 과거 버전으로 즉시 되돌리는 게 아니라, **그 버전 내용을 초안으로 불러온다** — 1B-4a에서 만든 "초안 → 검토 → 적용" 흐름을 그대로 재사용한다. 복구 자체가 바로 반영되는 게 아니라, 복구한 뒤에도 검토하고 "적용하기"를 눌러야 실제로 바뀐다.
- 복구 시점에 **이미 초안이 있으면, 그 초안을 통째로 덮어쓴다**(병합 아님) — 화면에서 확인창으로 경고한다.
- 목록은 **최근 50개**만 보여준다(개수 제한 없이 다 보여주는 대신 — 이 정도 규모의 내부 도구에서 정책이 50번 넘게 바뀔 일은 거의 없다고 보지만, 감사로그 화면(`LIMIT 200`)처럼 상한을 두는 관행을 따른다).
- 화면 위치는 "인재검색" 메뉴에 **새 서브탭 "버전 이력"**을 추가한다(대시보드/기준 관리센터 옆) — 기준 관리센터 화면이 더 길어지지 않게.

## 범위

**포함**: 버전 이력 목록 API+화면(최근 50개, 초안 제외), 과거 버전 하나를 초안으로 복구하는 API+버튼, 복구 시 기존 초안 덮어쓰기 확인.

**포함 안 함**: 가상 후보 3명 미리보기(1B-4c). 스키마 변경 없음 — 필요한 컬럼(`version_no`/`status`/`change_reason`/`created_by`/`applied_at`)이 이미 다 있다.

## 데이터 흐름

### 목록 조회

`talent_search_policy_versions`에서 `status != 'draft'`인 행을 `version_no DESC`로 최근 50개 조회한다. "누가 바꿨는지"는 `handlers/audit-log/index.js`가 이미 쓰는 조인 패턴을 그대로 재사용한다(`accounts.created_by` → `accounts.employee_id` → `members.name`, 이름 없으면 "(알 수 없음)"):

```sql
SELECT v.id, v.version_no, v.status, v.applied_at, v.change_reason, v.created_at,
       m.name AS created_by_name
FROM talent_search_policy_versions v
LEFT JOIN accounts a ON a.id = v.created_by
LEFT JOIN members m ON m.id = a.employee_id
WHERE v.status != 'draft'
ORDER BY v.version_no DESC
LIMIT 50
```

각 행에 정책 필드 전체(`level1Rules` 등)도 같이 내려준다 — 목록 화면 자체엔 필요 없지만, "복구" 버튼을 눌렀을 때 그 값을 그대로 초안에 넣어야 하므로 한 번의 조회로 끝낸다(행 개수가 최대 50개, 각 행의 JSONB도 작아서 응답 크기 문제 없음).

### 복구

새 함수 `restoreVersionAsDraft(versionId, actorAccountId)`(`handlers/_lib/talentSearchPolicy.js`에 추가):
- `versionId`로 그 버전 행을 조회(존재 안 하면 에러).
- 지금 있는 초안을 무조건 삭제(있으면 — 병합이 아니라 덮어쓰기이므로 `saveDraftOverrides`와는 다른 함수로 분리한다).
- 그 버전의 필드값을 그대로 복사해 새 초안 행을 INSERT(`version_no = MAX(version_no)+1`, `status='draft'`, `created_by=actorAccountId`, `change_reason`은 아직 비움 — 적용할 때 입력).

복구 대상 버전 자체가 지금 활성 버전이어도 막지 않는다(굳이 막을 이유가 없고, 화면에서는 애초에 활성 행에 "복구" 버튼을 안 보여주므로 실제로 이 경로를 탈 일이 없다).

## API

### `GET /api/talent-search-policy/versions`

`requireTalentSearchAccess`로 보호. 응답: `{ versions: [{ id, versionNo, status, appliedAt, changeReason, createdAt, createdByName, level1Rules, commonFitWeights, evidenceCoefficients, jobFitDefaultWeights, thresholds, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, ... }, ...] }`(최근 50개, 초안 제외, `versionNo` 내림차순).

### `PATCH /api/talent-search-policy/versions/:id/restore`

`requireTalentSearchAccess`로 보호. Body 없음. 그 버전을 초안으로 복구(기존 초안이 있었다면 덮어씀). 성공 시 `200 { ...policy_out(새 초안) }`(1B-4a의 `GET /talent-search-policy` 응답에서 `draft` 자리에 들어가는 것과 같은 모양).

## 화면

- "인재검색" 뷰의 서브탭에 `versions`를 추가(`switchTalentSearchTab`이 지금 `['dashboard','policy']`만 다루는 걸 3개로 확장).
- 버전 이력 표: 버전 번호 / 상태("현재 적용 중" 배지 또는 "과거") / 적용일시 / 변경한 사람 / 변경사유. 과거 행에만 "복구" 버튼.
- "복구" 클릭 → 지금 초안이 있으면 확인창("지금 초안이 있는데, 복구하면 그 초안 내용은 사라져요. 계속할까요?") → `PATCH /versions/:id/restore` 호출 → 성공하면 **기준 관리센터 서브탭으로 자동 전환**해서 곧바로 배너("수정 중인 초안이 있어요") + "기존→초안" 비교(1B-4a에서 이미 만든 것)를 보여준다 — 복구 전용의 새 비교 화면을 따로 만들지 않는다.

## 리스크 / 후속 확인 사항

- 목록이 50개로 잘리므로, 51번째 이전 버전은 화면에서 안 보인다 — 이 규모의 내부 도구에서 실제로 문제될 상황은 아니라고 판단하지만, 필요해지면 "더 보기"/페이지네이션은 후속 과제.
- 복구는 "그 버전의 스냅샷을 초안에 그대로 복사"이지, 지금 활성 버전과의 차이만 골라 병합하는 게 아니다 — 예를 들어 활성 버전이 그 사이 다른 필드도 바뀌었다면, 복구는 그 필드까지 포함해서 과거 버전 그대로 덮어쓴다(부분 복구 아님). 1B-4a의 "기존→초안" 비교 화면이 그 차이를 전부 보여주므로, 사용자가 적용 전에 뭐가 바뀌는지 확인할 수 있다.
- `created_by_name`이 "(알 수 없음)"으로 보이는 경우(계정이 나중에 비활성화/이름 변경된 경우 등)는 감사로그 화면과 동일한 한계를 그대로 받아들인다 — 새로 처리하지 않는다.
