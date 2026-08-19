# 인재검색 Phase 1B-2 — Level1 + 공통 40점 실제 수정 가능하게

- 작성일: 2026-08-19
- 선행 문서: `docs/superpowers/specs/2026-08-19-talent-search-phase1b1-policy-schema-design.md`(테이블·읽기전용 화면, 이미 완료)
- 관련 기존 파일: `sql/016_talent_search_policy.sql`, `handlers/talent-search-policy/index.js`, `handlers/_lib/accountAuth.js`(`requireTalentSearchAccess`), `index.html`의 `loadAndRenderTalentSearchPolicy()`

## 배경

Phase 1B-1에서 정책을 읽기 전용으로 보여주는 화면까지 완료했다. 이번엔 그중 **Level 1 문턱값**과 **공통 적합도 40점 배점**만 실제로 수정 가능하게 만든다(직무 60점·임계값·하루상한은 1B-3, 버전 이력·복구·가상후보 미리보기는 1B-4).

사용자 결정(빠르게 확인): 수정하면 **즉시 새 버전을 만들어 바로 적용**한다(초안 저장 단계 없음 — 그건 1B-4에서 "이전 버전 보기/되돌리기"와 함께 추가). Level1과 공통 40점은 **각각 별도의 "수정" 버튼**으로 나눈다. **변경사유 입력은 필수**다.

## 범위

**포함**: Level1 문턱값 수정 API+모달, 공통 40점 배점 수정 API+모달(합계 40 서버 검증), 두 API가 공유하는 "새 버전 생성" 헬퍼.

**포함 안 함**: 직무 60점/임계값/하루상한 수정(1B-3), 초안 상태·버전 이력 목록·이전 버전 복구·가상 후보 미리보기(1B-4), 항목 추가/삭제(공통 40점은 항상 고정된 5개 항목 — 이름과 배점만 수정 가능).

## 데이터 흐름

수정 = "현재 활성 버전을 복사하되 수정된 필드만 바꿔서 새 행으로 INSERT하고, 기존 활성 버전은 `superseded`로 변경"이다. 스키마 변경 없음 — 기존 `talent_search_policy_versions` 테이블에 행만 추가된다.

```js
// handlers/_lib/talentSearchPolicy.js (신설, 공유 헬퍼)
export async function getActivePolicy() { ... } // 1B-1의 GET 핸들러가 이미 쓰던 쿼리를 여기로 옮김
export function policy_out(row) { ... }          // 1B-1의 GET 핸들러에서 여기로 옮김 (PATCH 응답도 재사용)
export async function createPolicyVersion(current, overrides, actorAccountId, changeReason) {
  // current.version_no + 1로 새 행 INSERT(변경 안 된 필드는 current에서 그대로 복사),
  // 기존 current 행은 status='superseded'로 UPDATE. sql.transaction()으로 묶어서 원자적으로 처리.
}
```

## API

### `PATCH /api/talent-search-policy/level1-rules`

Body: `{ level1Rules: {...동일 구조...}, changeReason: string }`

검증: `changeReason` 비어있지 않음, `level1Rules`의 각 숫자 필드(90/180일, 12개월/5년/2회, 6/12개월)가 양의 정수, `exceptions`가 비어있지 않은 문자열 배열. (예외사유 목록 외의 필드 간 대소관계 같은 세밀한 검증은 이번 범위에 넣지 않는다 — "기능 먼저" 원칙에 따라 최소 검증만.)

성공 시 `createPolicyVersion`으로 새 버전 생성 후 `policy_out(새 행)` 반환.

### `PATCH /api/talent-search-policy/common-fit-weights`

Body: `{ commonFitWeights: [...5개...], changeReason: string }`

검증: `changeReason` 비어있지 않음, 정확히 5개 항목, 각 항목의 `key`가 기존 5개(`ownership`/`resultOriented`/`problemSolving`/`execution`/`collaboration`) 집합과 정확히 일치(추가·삭제 불가, 순서는 무관), `label` 비어있지 않은 문자열, `points`가 0 이상의 숫자, **합계가 정확히 40**이 아니면 400 거부.

성공 시 `createPolicyVersion`으로 새 버전 생성 후 반환.

두 엔드포인트 모두 `requireTalentSearchAccess`로 보호(1B-1과 동일 — ADMIN 전용 아님).

## 화면

기준 관리센터의 "1차 필터(Level 1) 기준" 카드와 "공통 적합도 40점" 카드 아래에 각각 **"수정" 버튼**을 추가한다. 누르면 모달(이 프로젝트의 기존 `showModal()` 패턴 재사용)이 뜨고:

- **Level1 모달**: 업데이트 기간 2칸(통과/확인필요 일수), 단기근속 3칸(개월/년/횟수) + 예외사유(쉼표로 구분해 입력), 공백 2칸(무시/확인필요 개월) — 지금 값이 미리 채워져 있음
- **공통 40점 모달**: 5개 행, 각각 이름(텍스트)·배점(숫자) 입력칸 + 실시간 합계 표시("합계: 38/40" 처럼, 40이 아니면 저장 버튼 비활성화 또는 저장 시 서버가 400 반환)
- 두 모달 공통: **변경 사유** 텍스트 입력(필수) + 저장/취소 버튼

저장 성공하면 모달 닫고 `loadAndRenderTalentSearchPolicy()`를 다시 호출해서 새 버전 번호와 값이 바로 반영되게 한다.

## 리스크 / 후속 확인 사항

- 동시에 두 사람이 같은 그룹을 수정하면(둘 다 "현재 버전 기준으로" 새 버전을 만들려고 시도) 나중에 저장한 쪽이 이길 수 있다 — 이 팀 규모(실제로 동시에 정책을 고칠 일이 거의 없음)에서는 낙관적 동시성 제어를 넣지 않고 넘어간다. 필요해지면 후속 과제.
- Level1 필드 간 정합성(예: 확인필요 일수가 통과 일수보다 커야 함)은 이번엔 검증하지 않는다 — 관리자가 실수로 이상한 값을 넣으면 나중에 눈으로 확인해서 다시 고치는 걸로 충분하다고 판단(내부 소규모 도구).
- 공통 40점 항목의 `key`는 고정이라, "이 5개 역량 자체를 바꾸고 싶다"는 요구가 생기면 이번 설계로는 안 되고 별도 스키마 변경이 필요하다 — 지금까지 요구사항엔 없었음.
