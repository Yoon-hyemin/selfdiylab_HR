# 인재검색 Phase 1B-4a — 초안(draft) 상태 도입

- 작성일: 2026-08-21
- 선행 문서: `docs/superpowers/specs/2026-08-19-talent-search-phase1b1-policy-schema-design.md`(정책 스키마, `status` 컬럼이 draft/active/superseded 컨벤션으로 이미 설계돼있음), `docs/superpowers/specs/2026-08-20-talent-search-phase1b3-design.md`(직전 단계, 5개 카드 전부 수정 가능하게 만든 상태)
- 관련 기존 파일: `handlers/_lib/talentSearchPolicy.js`(`getActivePolicy`/`createPolicyVersion`/`makePolicyPatchHandler`), `handlers/talent-search-policy/*.js`(5개 PATCH 핸들러), `index.html`의 `loadAndRenderTalentSearchPolicy()`/`openEditPointsListModal`/`openEditEvidenceModal`/`openEditThresholdsModal`

## 배경

Phase 1B는 원래 4단계로 쪼갰다: 1B-1(데이터구조+읽기전용) → 1B-2(Level1+공통40점 편집) → 1B-3(직무60점+근거수준+임계값·하루상한 편집) → **1B-4(초안·버전이력·복구·가상후보 미리보기)**. 1B-4 자체도 서로 다른 세 기능(① 초안 상태, ② 버전 이력 목록+복구, ③ 가상 후보 미리보기)이 묶여 있어서, 사용자 결정(이번 세션 확인)에 따라 다시 1B-4a(초안)/1B-4b(버전이력+복구)/1B-4c(가상후보미리보기) 세 단계로 나눈다. **이 문서는 1B-4a만** 다룬다.

지금(1B-1~1B-3)까지는 카드에서 "수정" → 저장 → **즉시 새 버전이 생성되고 바로 적용**되는 구조였다(`createPolicyVersion`이 "기존 활성 버전 supersede + 새 버전 insert-as-active"를 트랜잭션 하나로 처리). 이번엔 저장과 적용을 분리한다: 저장은 초안에만 반영되고, 별도의 "적용" 동작을 거쳐야 실제로 반영된다.

## 범위

**포함**: 초안 저장(기존 5개 카드의 저장 동작을 "즉시 적용"에서 "초안에 병합"으로 변경), 적용(초안 → 활성, 변경사유 이 시점에 한 번만 입력), 초안 버리기, 화면에 초안 존재 여부 배너 + 바뀐 카드만 보여주는 "기존 → 초안" 비교.

**포함 안 함**: 과거 버전 전체 목록 화면과 특정 과거 버전으로 되돌리기(1B-4b), 가상 후보 3명 미리보기(1B-4c). 스키마 변경 없음 — `talent_search_policy_versions.status`는 이미 draft/active/superseded 컨벤션으로 설계돼 있었다(`sql/016_talent_search_policy.sql`의 주석에 "초안/적용 전환 로직은 1B-4에서 추가한다"로 명시돼 있음).

## 사용자 결정 (이번 세션 확인)

- 저장은 **항상 초안으로만** 저장되고, 적용은 별도 버튼("적용하기")으로만 이루어진다 — 저장할 때마다 "지금 적용"/"초안 저장" 중 고르게 하지 않는다.
- **변경사유는 적용할 때 한 번만** 입력받는다 — 카드별로 저장할 때마다 사유를 물어보던 방식은 없어진다.
- 초안은 **한 번에 하나만** 존재한다 — 이미 초안이 있는 상태에서 다른 카드를 또 고치면 같은 초안에 계속 병합된다(여러 초안이 동시에 생기지 않음).

## 데이터 흐름

`talent_search_policy_versions`는 이미 `status`(draft/active/superseded) 컬럼이 있으므로 스키마 변경은 없다. 핵심은 "저장"과 "적용"을 서로 다른 트랜잭션으로 분리하는 것이다.

```js
// handlers/_lib/talentSearchPolicy.js

export async function getActivePolicy() { ... }          // 기존, 변경 없음
export async function getDraftPolicy() {                  // 신규
  const [row] = await sql`
    SELECT * FROM talent_search_policy_versions WHERE status = 'draft' LIMIT 1`;
  return row || null;
}

// 카드 저장 시 호출 — 활성 버전을 supersede하지 않는다.
// 초안이 이미 있으면 그 초안 행을 UPDATE(병합), 없으면 활성 버전을 베이스로
// 새 draft 행을 INSERT한다. version_no는 (현재 최댓값 + 1)로 계산해서,
// 초안을 버린 뒤 다시 만들 때 번호가 비어있으면 재사용된다.
export async function saveDraftOverrides(overrides, actorAccountId) {
  const draft = await getDraftPolicy();
  const base = draft || await getActivePolicy();
  if (!base) throw new Error('적용 중인 기준이 없어요');
  const next = { ...base, ...overrides };
  if (draft) {
    // UPDATE draft row in place (같은 id, version_no 유지)
  } else {
    // INSERT new row: version_no = (SELECT MAX(version_no)+1), status='draft',
    // change_reason/applied_at은 아직 null
  }
  return /* 최신 draft row */;
}

// "적용하기" — 초안을 활성으로 승격, 기존 활성은 superseded로.
export async function applyDraft(changeReason, actorAccountId) {
  const draft = await getDraftPolicy();
  if (!draft) throw new Error('적용할 초안이 없어요');
  const current = await getActivePolicy();
  // 트랜잭션: UPDATE current SET status='superseded';
  //           UPDATE draft SET status='active', applied_at=now(),
  //             change_reason=changeReason, created_by=actorAccountId
  return /* 승격된 row */;
}

// "초안 버리기"
export async function discardDraft() {
  await sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`;
}
```

`makePolicyPatchHandler`는 내부에서 `getActivePolicy`+`createPolicyVersion`(즉시 적용) 대신 `saveDraftOverrides`(초안 병합)를 호출하도록 바뀐다. 5개 핸들러 파일(`level1-rules.js`/`common-fit-weights.js`/`job-fit-weights.js`/`evidence-coefficients.js`/`thresholds.js`) 자체는 `validate`/`buildOverrides`만 그대로 넘기면 되므로 수정이 필요 없다 — 팩토리 내부만 바뀐다. **`changeReason`도 이 요청에서 더 이상 받지 않는다** — 5개 핸들러의 PATCH body에서 `changeReason` 필드를 제거한다(프론트에서도 카드 모달의 "변경 사유" 입력칸을 없앤다).

`createPolicyVersion`(기존, supersede+즉시insert-as-active)은 이 리팩터 이후 아무도 호출하지 않게 된다 — 죽은 코드로 남기지 않고 제거하거나, `applyDraft`의 "활성 승격" 트랜잭션과 합쳐서 재구성한다(정확한 정리 방식은 구현 계획에서 결정).

지난 라운드(1B-3 최종 리뷰)에서 추가한 안전장치(`validateOverrideKeys` — `buildOverrides`가 알려진 컬럼명이 아닌 키를 반환하면 조용히 무시하지 않고 에러를 던짐)는 `saveDraftOverrides`에도 그대로 적용한다.

## API

### `GET /api/talent-search-policy` (기존 엔드포인트, 응답 모양 확장)

기존에는 활성 버전만 반환했다. 이제 **활성 버전 필드는 최상위에 그대로 유지**하고(하위호환), 초안이 있으면 `draft` 키에 같은 모양으로 추가한다:

```
{ ...기존 활성 버전 필드 그대로, draft: null | { versionNo, level1Rules, ..., status:'draft' } }
```

### 5개 기존 PATCH 엔드포인트 (동작 변경, 경로/이름 변경 없음)

`level1-rules`/`common-fit-weights`/`job-fit-weights`/`evidence-coefficients`/`thresholds` — body에서 `changeReason` 필드 제거(더 이상 요구하지 않음), 나머지 body 모양은 동일. 응답은 이제 **초안 행**의 `policy_out`(즉 `status:"draft"`가 찍힘) — 활성 버전은 그대로 남아있다.

### `PATCH /api/talent-search-policy/draft/apply` (신규)

Body: `{ changeReason: string }` — 필수(빈 문자열 거부, 기존 5개 핸들러가 하던 검증과 동일한 규칙).
초안이 없으면 404. 성공 시 승격된(활성이 된) 버전을 `policy_out`으로 반환.

### `DELETE /api/talent-search-policy/draft` (신규)

Body 없음. 초안이 없어도 그냥 200(멱등) — 이미 없는 걸 지우려 해도 에러 낼 필요 없음.

세 엔드포인트 모두 `requireTalentSearchAccess`로 보호(기존과 동일, ADMIN 전용 아님).

## 화면

- `loadAndRenderTalentSearchPolicy()`가 `GET /talent-search-policy` 응답의 `draft` 필드를 확인한다.
- **초안이 없으면**: 지금과 완전히 동일하게 동작(활성 값 표시, 카드 수정 시 저장만 하면 끝 — 다만 이제 "변경사유" 입력칸은 모달에서 사라짐).
- **초안이 있으면**: 상단에 배너 — "수정 중인 초안이 있어요 (아직 적용되지 않았어요)" + **[적용하기]** / **[초안 버리기]** 버튼. 카드들은 초안의 값을 보여준다(계속 이어서 고칠 수 있도록). 배너 아래에 활성 버전과 값이 다른 카드만 나열해서 "기존 → 초안"을 나란히 비교해서 보여준다(같은 카드 렌더링 함수를 재사용해서 두 번 그림 — 새 diff 로직을 따로 만들지 않는다).
- **[적용하기]** 클릭 → 모달(변경사유 입력, 필수) → 저장 → `PATCH /draft/apply` → 배너 사라지고 화면이 새 활성 버전으로 다시 그려짐.
- **[초안 버리기]** 클릭 → 확인(되돌릴 수 없다는 짧은 안내) → `DELETE /draft` → 배너 사라지고 화면이 다시 활성 버전 기준으로 그려짐.

## 리스크 / 후속 확인 사항

- **`applied_at`/`created_by`/`change_reason`이 "감사로그" 역할을 그대로 한다** — 별도의 `audit_log` 테이블(계정 관리 화면에서 쓰는 것)에는 기록하지 않는다. 버전 이력 자체가 감사로그이므로 중복 기록이 불필요하다고 판단(1B-4b에서 이 이력을 화면으로 보여줄 예정).
- **동시 편집**: 초안이 전역에서 하나뿐이라, 두 사람이 동시에 서로 다른 카드를 고치면 마지막 저장이 이긴다(먼저 저장한 사람의 변경은 `{...draft, ...overrides}` 병합 규칙 덕분에 사라지지 않고 유지되긴 하지만, 두 사람이 "같은 필드"를 동시에 고치면 나중 저장이 이김) — 이 프로젝트 전체가 채택한 "내부 소규모 도구라 낙관적 동시성 제어는 넣지 않는다" 원칙을 그대로 따른다.
- **`createPolicyVersion` 제거/재구성**은 구현 단계에서 실제 코드를 보면서 정할 부분 — `applyDraft`가 필요로 하는 트랜잭션(활성 supersede + 특정 행을 active로 승격)은 `createPolicyVersion`(새 행을 insert하며 active로 만듦)과 모양이 다르므로 완전히 재사용은 안 되고, 필요한 부분만 가져와 새로 작성한다.
- 화면 diff는 "값이 다른 카드만" 보여주는 수준으로 충분하다고 판단(예: 공통40점 안에서 항목 하나만 바뀌어도 그 카드 전체를 기존/초안 나란히 보여줌 — 항목 단위 세밀한 diff는 만들지 않음). 필요해지면 후속 과제.
