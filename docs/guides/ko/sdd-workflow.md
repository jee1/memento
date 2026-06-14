# SDD(Specification-Driven Development) 워크플로 가이드

Memento 프로젝트는 기능 개발 시 코드 작성보다 명세 작성을 먼저 완료하는 SDD(Specification-Driven Development) 방식을 따릅니다. 이 방식의 핵심은 "무엇을 만들 것인가"를 충분히 정리한 뒤 "어떻게 만들 것인가"를 계획하고, 그 계획을 기준으로 구현한다는 순서입니다. 이 가이드는 그 순서를 따르는 방법과 문서가 어디에 위치하는지를 설명합니다.

## 단계 개요

SDD는 Design → SPECIFY → PLAN → Implement 네 단계로 진행됩니다. 반드시 이 순서를 지킬 필요는 없지만, 설계가 정리된 뒤 명세를 쓰고, 명세가 확정된 뒤 계획을 작성해야 구현 시 임의 판단을 최소화할 수 있습니다.

**Design** 단계에서는 요구사항과 접근 방식을 자유롭게 정리합니다. 아직 결론이 없는 브레인스토밍 단계이므로 형식보다 내용에 집중합니다.

**SPECIFY** 단계에서는 구현 명세를 작성합니다. 요구사항(REQ-XXX), 제약(CON-XXX), 수용 기준(AC1, AC2, …)을 구체화하여 "완료"의 기준을 명확히 합니다.

**PLAN** 단계에서는 명세를 기반으로 구현 계획을 세웁니다. Phase와 Task로 나뉘며, 각 Task는 독립적으로 실행 가능한 단위여야 합니다.

**Implement** 단계에서는 PLAN의 Task 순서대로 코드와 테스트를 작성합니다. 완료 여부는 SPEC의 수용 기준(AC)을 기준으로 판단합니다.

## 문서 위치

기능마다 하나의 디렉터리를 두고, Design·SPEC·PLAN을 같은 경로에 함께 둡니다.

```
docs/_work/plans/ko/YYYY-MM-DD-<기능명>/
├── design.md                # 설계·브레인스토밍 (Design)
├── spec.md                  # 구현 명세 (SPECIFY)
├── implementation-plan.md   # 구현 계획 (PLAN)
├── Structure.md             # (선택) 아키텍처·디렉터리 구조
├── Tech.md                  # (선택) 기술 스택·DB·제약
└── Product.md               # (선택) 비즈니스 맥락·기존 기능과의 연관
```

예를 들어 `docs/_work/plans/ko/2026-03-11-memento-cli-for-ai/`처럼 날짜와 기능명을 조합한 디렉터리를 만들고, 그 안에 세 개의 핵심 문서를 둡니다. 복잡한 기능이거나 여러 세션·에이전트가 참여할 때는 Memory Bank(Structure.md, Tech.md, Product.md)를 추가하면 구현 시 구조·기술·제품 맥락을 일관되게 유지할 수 있습니다.

이슈만 있고 기능 디렉터리를 아직 만들지 않았다면 `docs/_work/design/` 또는 `docs/_work/brainstorms/`에 설계 문서를 먼저 작성할 수 있습니다. SPEC·PLAN을 작성할 때 기능 디렉터리를 만들고, 설계 문서를 `design.md`로 복사하거나 링크로 참조하면 됩니다.

## SPEC 작성 요건

spec.md에는 다음 항목이 포함되어야 합니다.

- **메타데이터**: 기능명, 문서 유형(SPECIFY), 버전, 날짜, 상태, 관련 이슈, 설계 문서 링크
- **범위**: In scope / Out of scope 명시
- **요구사항**: REQ-XXX 형식, 각 항목별 수용 조건 포함
- **제약**: CON-XXX 형식 (보안, 호환성, 기술 제약 등)
- **수용 기준**: AC1, AC2, … — "완료" 판단 기준
- **다음 단계**: 같은 디렉터리의 `implementation-plan.md` 링크

## PLAN 작성 요건

implementation-plan.md에는 다음 항목이 포함되어야 합니다.

- **메타데이터**: 기능명, 문서 유형(PLAN), 기준 명세(spec.md 링크), 관련 이슈
- **개요**: 목표, 구현 위치, 의존성
- **보안·컨벤션**: 구현·리뷰 시 준수할 정책
- **Phase·Task**: 단계별 목표, 산출물, SPEC 요구사항 매핑. 각 Task는 실행 가능한 단위
- **검증 방법**: 단위 테스트·E2E·수동 확인 방법

## 현재 상태를 SDD에 맞추는 방법

이미 구현이 진행 중이거나 이슈만 있는 경우에도 사후에 SPEC 요약과 PLAN 요약을 작성해두면 이후 수정·리뷰·온보딩 시 기준 문서가 됩니다.

새 기능을 시작할 때 권장하는 순서는 다음과 같습니다.

1. `docs/_work/plans/ko/YYYY-MM-DD-<기능명>/` 디렉터리를 만들고 `design.md`를 작성합니다.
2. 설계가 충분히 정리되면 `spec.md`를 작성하여 범위·REQ/CON/AC를 확정합니다.
3. `implementation-plan.md`를 작성합니다. 필요하면 Memory Bank를 추가합니다.
4. PLAN의 Task 단위로 구현하고, SPEC의 AC로 완료를 검증합니다.

## 체크리스트

| 시점 | 확인 사항 |
|------|----------|
| 기능 시작 전 | Design 문서가 존재하는가. 없으면 설계 정리 후 진행. |
| SPEC 작성 후 | 범위·REQ/CON/AC가 구현 가능한 수준으로 구체화되었는가. |
| PLAN 작성 후 | Phase·Task가 SPEC 요구사항과 매핑되는가. 검증 방법이 명시되었는가. |
| 구현 완료 시 | SPEC의 수용 기준(AC)을 모두 만족하는가. |

## 참고 문서

- `docs/README.md` — 명세(specs)·계획(plans) 섹션 인덱스
- `docs/_work/plans/ko/2026-03-11-memento-cli-for-ai/` — 실제 사용 예시 (design.md, spec.md, implementation-plan.md 포함)
