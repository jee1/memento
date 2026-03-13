# SDD(Specification-Driven Development) 워크플로 가이드

**하는 일**: Memento 저장소에서 기능 개발 시 SPEC → PLAN → 구현 순서를 따르기 위한 절차와 문서 위치를 정리한다.  
**대상**: 기여자, 에이전트(AGENTS.md 참조).

---

## 1. SDD 단계 개요


| 단계            | 산출물         | 위치                                                    | 설명                                            |
| ------------- | ----------- | ----------------------------------------------------- | --------------------------------------------- |
| **Design**    | 설계·브레인스토밍   | 기능별 디렉터리 내 `design.md` (아래 §2 참조). 또는 `docs/design/`, `docs/brainstorms/` | 요구사항 논의, 접근 방식, 제약 사항 정리.                     |
| **SPECIFY**   | 구현 명세(SPEC) | 기능별 디렉터리 내 `spec.md` (아래 §2 참조)                  | 요구사항(REQ-*), 제약(CON-*), 수용 기준(AC*), 범위·메타데이터. |
| **PLAN**      | 구현 계획(PLAN) | 같은 디렉터리 내 `implementation-plan.md`                     | Phase·Task, 보안·컨벤션, 검증. 필요 시 Memory Bank.     |
| **Implement** | 코드·테스트·문서   | 저장소 소스·테스트·가이드                                        | PLAN의 Task 단위로 구현.                            |


**원칙**: 설계가 정리된 뒤 SPEC을 쓰고, SPEC이 확정된 뒤 PLAN을 쓴다. 구현 시에는 SPEC·PLAN을 기준 문서로 사용한다.

---

## 2. 문서 경로 및 네이밍 (기능별 동일 경로)

**기능마다 하나의 디렉터리**를 두고, Design·SPEC·PLAN을 **같은 경로**에 둔다.

- **기능 디렉터리**: `docs/plans/ko/YYYY-MM-DD-<기능명>/`
- **Design**: 위 디렉터리 안의 `design.md` (설계·브레인스토밍 초안)
- **SPEC**: 위 디렉터리 안의 `spec.md`
- **PLAN**: 위 디렉터리 안의 `implementation-plan.md`
- **Memory Bank**(선택): 같은 디렉터리 안의 `Structure.md`, `Tech.md`, `Product.md`

예시:

```
docs/plans/ko/2026-03-11-memento-cli-for-ai/
├── design.md                # 설계·브레인스토밍 (Design)
├── spec.md                  # 구현 명세 (SPECIFY)
├── implementation-plan.md   # 구현 계획 (PLAN)
├── Structure.md             # (선택) 아키텍처·디렉터리 구조
├── Tech.md                  # (선택) 기술 스택·DB·제약
└── Product.md               # (선택) 비즈니스 맥락·기존 기능과의 연관
```

복잡한 기능이거나 여러 세션/에이전트가 참여할 때 Memory Bank를 두면, 구현 시 “임의 판단”을 줄이고 구조·기술·제품 맥락을 일관되게 유지할 수 있다.

**Design을 다른 경로에 둘 때**: 이슈만 있고 기능 디렉터리를 아직 만들지 않았다면 `docs/design/` 또는 `docs/brainstorms/`에 설계 문서를 먼저 둘 수 있다. SPEC/PLAN을 작성할 때 해당 기능 디렉터리(`plans/ko/YYYY-MM-DD-기능명/`)를 만들고, design 문서를 `design.md`로 복사·이동하거나 링크로 참조하면 된다.

**참고**: 과거에는 Design은 `docs/design/`·`docs/brainstorms/`, SPEC/PLAN은 `docs/specs/ko/`·`docs/plans/ko/`에 나뉘어 있었으나, 앞으로는 위와 같이 **기능별 디렉터리에 design + spec + plan**을 함께 둔다. 기존 문서는 필요 시 이 구조로 옮기거나 링크만 통일할 수 있다.

---

## 3. SPEC(명세) 작성 요건

- **메타데이터**: 기능명, 문서 유형(SPECIFY), 버전, 날짜, 상태, 관련 이슈, 설계 문서 링크.
- **범위**: In scope / Out of scope.
- **요구사항**: REQ-XXX 형식, 각 항목별 수용 조건 명시.
- **제약**: CON-XXX (보안, 호환성, 기술 제약 등).
- **수용 기준**: AC1, AC2, … — SPEC 대비 “완료” 판단 기준.
- **다음 단계**: 같은 디렉터리의 implementation-plan.md 링크.

참고: [plans/ko/2026-03-11-memento-cli-for-ai/spec.md](../plans/ko/2026-03-11-memento-cli-for-ai/spec.md)

---

## 4. PLAN(구현 계획) 작성 요건

- **메타데이터**: 기능명, 문서 유형(PLAN), 기준 명세(같은 디렉터리 spec.md 링크), 관련 이슈, Memory Bank 링크(있는 경우).
- **Memory Bank**(선택): 같은 디렉터리의 Structure / Tech / Product 3종 참조.
- **개요**: 목표, 구현 위치, 의존성, 명세 갱신 반영 여부.
- **보안·컨벤션·개발 철학**: 구현·리뷰 시 준수할 정책.
- **Phase·Task**: 단계별 목표, 산출물, 명세 요구사항 매핑. 각 Task는 실행 가능한 단위로.
- **검증**: 단위 테스트·E2E·수동 확인 방법.

참고: [plans/ko/2026-03-11-memento-cli-for-ai/implementation-plan.md](../plans/ko/2026-03-11-memento-cli-for-ai/implementation-plan.md)

---

## 5. 현재 상태를 SDD에 맞추는 방법

### 5.1 이미 이슈/제안만 있는 경우 (예: docs/issues/)

1. **기능 디렉터리 생성**: `docs/plans/ko/YYYY-MM-DD-<기능명>/`를 만든다.
2. **Design 정리**: 위 디렉터리 안에 `design.md`를 두고 설계 초안을 쓴다. 이미 `docs/design/`·`docs/brainstorms/`에 문서가 있으면 해당 디렉터리로 복사·이동하거나 링크로 참조한다.
3. **SPEC 작성**: 같은 디렉터리에 `spec.md`를 만들고, 범위·REQ/CON/AC를 정리한다. 관련 이슈·design.md를 메타데이터에 링크한다.
4. **PLAN 작성**: 같은 디렉터리에 `implementation-plan.md`를 작성한다. 필요하면 Structure.md, Tech.md, Product.md(Memory Bank)를 추가한다.
5. **구현**: PLAN의 Phase·Task 순서대로 구현하고, SPEC의 수용 기준(AC)으로 완료를 판단한다.

### 5.2 이미 구현이 진행 중인 기능

- 사후에라도 **SPEC 요약**과 **PLAN 요약**을 두면, 이후 수정·리뷰·온보딩 시 기준 문서가 된다.  
- 기존 설계 문서(design/)가 있으면 SPEC에 “설계 문서”로 링크하고, PLAN에서 “기준 명세”로 해당 SPEC을 참조한다.

### 5.3 새 기능을 시작할 때

1. **기능 디렉터리** `docs/plans/ko/YYYY-MM-DD-<기능명>/`를 만들고, **Design**을 `design.md`로 둔다(또는 기존 design/·brainstorms/ 문서를 여기로 옮기거나 링크).
2. **SPEC**(`spec.md`)을 작성하고, 범위·요구사항·수용 기준을 확정한다.
3. **PLAN**(`implementation-plan.md`)을 작성한다(필요 시 Memory Bank 포함).
4. PLAN의 Task 단위로 구현하고, SPEC의 AC로 완료를 검증한다.

---

## 6. 체크리스트 요약


| 시점            | 확인 사항                                        |
| ------------- | -------------------------------------------- |
| **기능 시작 전**   | Design 문서 존재 여부. 없으면 설계 정리 후 진행.             |
| **SPEC 작성 후** | 범위·REQ/CON/AC가 구현 가능한 수준으로 구체화되었는지.          |
| **PLAN 작성 후** | Phase·Task가 SPEC 요구사항과 매핑되는지. 검증 방법이 명시되었는지. |
| **구현 완료 시**   | SPEC의 수용 기준(AC)을 모두 만족하는지.                   |


---

## 7. 참고 문서

- **문서 인덱스**: [docs/README.md](../README.md) — 명세(specs)·계획(plans) 섹션.
- **분류 체계**: [docs-classification.md](../docs-classification.md).
- **예시(CLI for AI)**: [plans/ko/2026-03-11-memento-cli-for-ai/](../plans/ko/2026-03-11-memento-cli-for-ai/) — [design.md](../plans/ko/2026-03-11-memento-cli-for-ai/design.md), [spec.md](../plans/ko/2026-03-11-memento-cli-for-ai/spec.md), [implementation-plan.md](../plans/ko/2026-03-11-memento-cli-for-ai/implementation-plan.md), [Memory Bank(Structure/Tech/Product)](../plans/ko/2026-03-11-memento-cli-for-ai/).

