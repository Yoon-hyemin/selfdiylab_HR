# 인재검색 Phase 1B-3 — 직무 60점 + 근거수준별 점수 + 임계값·하루상한 실제 수정 가능하게

- 작성일: 2026-08-20
- 선행 문서: `docs/superpowers/specs/2026-08-19-talent-search-phase1b1-policy-schema-design.md`(테이블·읽기전용 화면), `docs/superpowers/specs/2026-08-19-talent-search-phase1b2-policy-editing-design.md`(Level1+공통40점 수정, 이미 완료)
- 관련 기존 파일: `handlers/_lib/talentSearchPolicy.js`(`getActivePolicy`/`policy_out`/`createPolicyVersion`), `handlers/talent-search-policy/level1-rules.js`, `handlers/talent-search-policy/common-fit-weights.js`, `index.html`의 `loadAndRenderTalentSearchPolicy()`

## 배경

Phase 1B-2에서 Level1 문턱값과 공통 40점 배점을 실제로 수정 가능하게 만들었다. 이번엔 남은 세 카드를 마저 연다: **직무 적합도 60점 기본 배점**, **근거수준별 점수**, **추천 임계값·하루 추천 상한**. 이걸로 기준 관리센터의 모든 카드가 읽기전용에서 벗어난다(1B-4는 버전 이력·복구·가상후보 미리보기라 값 자체를 바꾸는 기능은 이번이 마지막).

사용자 결정(이번 세션 확인):
- 근거수준별 점수도 이번에 같이 연다(원래 1B-3 후보에 없었으나, 직무 60점·임계값과 같은 "채점 기준" 묶음이라 같이 처리하는 게 자연스럽다는 데 합의).
- 직무 60점도 공통 40점과 동일하게 **항목 자유 추가/삭제**(6개 고정 아님), 합계는 정확히 60점.
- 하루 추천 상한은 **기본값과 절대상한 둘 다** 화면에서 수정 가능(단, 기본값이 절대상한을 넘을 수는 없다).

## 범위

**포함**: 직무 60점 수정 API+모달(합계 60 검증, 항목 추가/삭제), 근거수준별 점수 수정 API+모달(0~100% 검증 + "명확≥부분≥약함≥없음" 순서 검증), 추천 임계값·하루 추천상한 수정 API+모달(하나의 모달로 묶음 — 지금 화면에서도 한 카드로 같이 표시되고 있음). 지난 두 라운드에서 쌓인 기술부채 정리: PATCH 핸들러 공용 팩토리, 검증 로직을 DB 의존성 없는 파일로 분리.

**포함 안 함**: 초안 상태·버전 이력 목록·이전 버전 복구·가상 후보 미리보기(1B-4). 실제 검색 프로젝트별 직무기준 생성(원본 명세서 7장의 "직무별 동적 세부기준" — 이건 검색 프로젝트가 생기는 Phase 1C~1D 이후의 별도 기능이고, 여기서 다루는 건 회사 전체 공용 **기본 템플릿** 배점이다).

## 데이터 흐름 — 지난 라운드와 동일 + 구조 정리

수정 = "현재 활성 버전을 복사하되 수정된 필드만 바꿔서 새 행으로 INSERT, 기존 활성 버전은 `superseded`로 변경". 스키마 변경 없음.

지금까지 Level1/공통40점 핸들러 2개가 구조를 그대로 반복해왔고(메서드검사→권한검사→changeReason검사→검증→조회→생성→응답), 이번에 3개가 더 늘어나 총 5개가 되므로 공용 팩토리로 묶는다:

```js
// handlers/_lib/talentSearchPolicy.js에 추가
// validate(body): body(= req.body에서 changeReason 뺀 나머지)를 검사해 에러 메시지 문자열 또는 null 반환
// buildOverrides(body): body를 새 버전에 반영할 snake_case 필드 객체로 변환
export function makePolicyPatchHandler({ validate, buildOverrides }) {
  return async function handler(req, res) {
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    const account = await requireTalentSearchAccess(req, res);
    if (!account) return;
    const { changeReason, ...body } = req.body || {};
    if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });
    const validationError = validate(body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
      const current = await getActivePolicy();
      if (!current) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
      const updated = await createPolicyVersion(current, buildOverrides(body), account.id, changeReason.trim());
      return res.status(200).json(policy_out(updated));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '기준 수정에 실패했어요' });
    }
  };
}
```

각 핸들러 파일(`level1-rules.js`, `common-fit-weights.js`, 이번에 새로 생기는 3개)은 이 팩토리에 `validate`/`buildOverrides`만 넘기는 얇은 코드로 정리한다. **기존 두 핸들러(Level1/공통40점)도 이 팩토리를 쓰도록 같이 정리한다** — 동작은 그대로고 구조만 통일한다(회귀 방지를 위해 기존 단위테스트도 그대로 통과해야 함).

검증 함수는 새 파일 `handlers/_lib/talentSearchPolicyValidate.js`(DB import 없음)로 분리해서, `handlers/_lib/db.js`가 `DATABASE_URL` 없으면 모듈 로드 시점에 throw하는 문제 때문에 순수 로직 테스트조차 못 돌리던 문제를 해소한다. **기존 `validateLevel1Rules`/`validateCommonFitWeights`도 이 파일로 옮기고**, 두 기존 테스트 파일(`level1-rules.test.js`/`common-fit-weights.test.js`)의 import 경로만 이 새 파일로 바꾼다(테스트 내용 자체는 변경 없음).

공통 40점과 직무 60점은 "항목 배열 + 합계 검증"이라는 같은 모양이라 내부적으로 하나의 `validatePointsList(items, expectedSum)` 헬퍼를 공유한다(사용자에게 보이는 동작은 지난 라운드와 동일 — 코드 재사용일 뿐).

## API

### `PATCH /api/talent-search-policy/job-fit-weights`

Body: `{ jobFitDefaultWeights: [...], changeReason: string }` — 항목 구조는 공통 40점과 동일(`{key, label, points}`).

검증: 배열 1개 이상, `key` 중복 없는 비어있지 않은 문자열, `label` 비어있지 않은 문자열, `points` 0 이상 숫자, **합계 정확히 60**.

### `PATCH /api/talent-search-policy/evidence-coefficients`

Body: `{ evidenceCoefficients: {none, weak, partial, clear}, changeReason: string }` — 저장 형식은 지금과 동일하게 0~1 사이 소수(예: 0.65). 화면에서는 %로 입력받아 저장 직전에 소수로 변환한다(기존 표시 로직 `Math.round(ec.none*100)`과 대칭).

검증: 네 값 모두 0보다 크고 1 이하인 숫자, 그리고 **`none ≤ weak ≤ partial ≤ clear`** 순서를 지켜야 함(순서가 깨지면 "약한 근거"가 "명확한 근거"보다 점수를 더 받는 모순이 생기므로 서버가 거부).

### `PATCH /api/talent-search-policy/thresholds`

Body: `{ thresholds: {totalScoreMin, jobFitScoreMin, minMeaningfulEvidenceCount}, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, changeReason: string }`

검증: `totalScoreMin` 0~100 사이 정수, `jobFitScoreMin` 0~60 사이 정수(직무 60점 만점 기준 — 직무 항목 합계가 항상 60으로 강제되므로 이 상한은 고정값), `minMeaningfulEvidenceCount` 1 이상 정수, `dailyRecommendCapDefault`/`dailyRecommendCapAbsoluteMax` 둘 다 1 이상 정수, **`dailyRecommendCapDefault ≤ dailyRecommendCapAbsoluteMax`**.

세 엔드포인트 모두 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님, 지난 라운드와 동일).

## 화면

기준 관리센터의 남은 세 카드에 "수정" 버튼을 추가한다.

- **직무 적합도 60점 모달**: 공통 40점 모달과 동일한 UI(이름·배점 입력 행 + "항목 추가"/"삭제" + 실시간 합계 표시, 60이 아니면 저장 막힘) — 코드도 공통 40점 모달 렌더링 함수를 재사용하도록 일반화한다(라벨/합계 목표값만 다르게 넘김).
- **근거수준별 점수 모달**: 없음/약함/부분/명확 4칸(% 입력, 0~100), 저장 시 순서(명확≥부분≥약함≥없음) 어긋나면 에러 메시지로 안내.
- **추천 임계값·하루 추천상한 모달**: 총점기준/직무점수기준/의미있는근거개수/하루상한 기본값/하루상한 절대상한 5칸을 한 모달에 — 지금 화면에서도 이 다섯 값이 "추천 임계값 · 하루 추천 상한" 카드 하나에 같이 표시되고 있어서 수정도 하나로 묶는다.
- 세 모달 모두 **변경 사유** 필수 입력 + 저장/취소, 저장 성공 시 `loadAndRenderTalentSearchPolicy()` 재호출로 새 버전 즉시 반영 — 지난 라운드와 동일한 패턴.

## 테스트

새 검증 로직 3종(`validateJobFitDefaultWeights` 또는 공유 `validatePointsList`, `validateEvidenceCoefficients`, `validateThresholdsAndCaps`) 각각에 대해 지난 라운드와 같은 스타일의 단위테스트를 `handlers/_lib/talentSearchPolicyValidate.test.js`(또는 각 항목별 파일)에 추가한다 — 이제 DB 없이도 돌아간다.

## 리스크 / 후속 확인 사항

- 근거수준별 점수의 순서 검증(명확≥부분≥약함≥없음)은 이번에 새로 추가하는 규칙이라, 혹시 실제로 순서를 깨고 싶은 특수한 상황(예: 의도적으로 "약함"에 더 높은 점수를 주고 싶은 경우)이 생기면 이 검증 때문에 막힐 수 있다 — 지금은 그런 요구가 없다고 판단해 막아두지만, 필요해지면 후속 과제로 완화한다.
- `jobFitScoreMin`의 상한을 60으로 고정했는데, 만약 나중에 직무 60점 총점 자체가 60이 아닌 다른 값으로 바뀔 수 있게 설계가 바뀐다면(현재는 항상 60 고정) 이 상한도 같이 손봐야 한다 — 지금 설계에서는 직무 60점 합계가 항상 정확히 60으로 강제되므로 문제 없음.
- Level1/공통40점 핸들러를 공용 팩토리로 옮기는 리팩터는 동작 변경이 없어야 하므로, 기존 단위테스트가 그대로 통과하는 것으로 회귀 여부를 확인한다(수동 UI 확인도 병행).
- 지난 라운드와 동일하게 동시 수정 시 낙관적 동시성 제어는 넣지 않는다(내부 소규모 도구, 우선순위 낮음).
