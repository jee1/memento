# 현 상태를 SDD에 맞추기 — 문서 정리·신규 생성 검토

**목적**: 이미 개발이 완료되었거나 진행 중인 현재 상태를, SDD(기능별 동일 경로: design → spec → implementation-plan)에 맞게 기존 문서를 정리하고 필요한 신규 문서를 어떻게 생성할지 검토한다.  
**대상**: [guides/ko/sdd-workflow.md](../../../guides/ko/sdd-workflow.md)에서 정한 `docs/_work/plans/ko/YYYY-MM-DD-기능명/` 내 design.md, spec.md, implementation-plan.md.

---

## 1. 현재 문서 현황 요약

### 1.1 경로별 보유 문서

| 경로 | 보유 문서 | 비고 |
|------|-----------|------|
| **docs/_work/design/** | memento-cli-for-ai-review.md, recall-context-saving-ideas.md | 설계·리뷰 초안 |
| **docs/_work/brainstorms/** | 2026-03-04-monorepo-memento-core-brainstorm.md | 모노레포 설계 논의 |
| **docs/specs/ko/** | 2026-03-11-memento-cli-for-ai-spec.md | SPEC은 현재 이 기능만 존재 |
| **docs/_work/plans/ko/** | 아래 표 참조 | 플랫 파일 + 2026-03-11-memento-cli-for-ai/ (Memory Bank 3종) |
| **docs/_work/issues/** | 2026-03-13-memento-cli-skills-for-llm.md | 미착수 기능 제안 |

### 1.2 plans/ko/ 상세 (기능·유형별)

| 파일 또는 디렉터리 | 유형 | 해당 기능(그룹) |
|--------------------|------|----------------|
| 2026-03-11-memento-cli-for-ai-implementation-plan.md | PLAN | Memento CLI for AI |
| 2026-03-11-memento-cli-for-ai/ (Structure, Tech, Product) | Memory Bank | Memento CLI for AI |
| 2026-03-04-monorepo-memento-core-implementation-plan.md | PLAN | 모노레포·memento-core |
| 2026-03-04-monorepo-phase3-thin-server-plan.md | PLAN | 동일 (phase3) |
| 2026-03-03-repo-cleanup-design.md | Design | 저장소 정리 |
| 2026-03-03-repo-cleanup-implementation-plan.md | PLAN | 저장소 정리 |
| 2026-03-03-scripts-inventory.md | 기타 | 저장소 정리 보조 |
| 2026-03-02-memento-growth-strategy-design.md | Design | 성장 전략 |
| 2026-02-10-issue-21-meta-memory-introspection.md | 설계/계획 | 메타 메모리 인트로스펙션 |
| 2026-02-08-issue-91-process-attribute-recall.md | 설계/계획 | 프로세스 속성 recall |
| 2026-02-08-issue-90-triples-kg-dedupe-implementation-plan.md | PLAN | Triples/KG 중복 제거 |
| 2026-02-08-issue-89-async-augmentation-implementation-plan.md | PLAN | 비동기 보강 |
| 2026-02-08-issue-88-fact-metadata-implementation-plan.md | PLAN | Fact 메타데이터 |
| 2026-02-08-issue-87-attribution-implementation-plan.md | PLAN | Memori Attribution |
| 2026-02-07-issue-priority-review.md | 기타 | 이슈 우선순위 검토 |
| 2026-02-07-memori-inspired-design.md | Design | Memori 영감 설계 |
| 2026-02-05-remember-procedure-design.md | Design | remember_procedure |
| 2026-02-05-procedural-version-management-design.md | Design | Procedural 버전 관리 |
| 2026-02-05-procedural-version-management-implementation-plan.md | PLAN | 동일 |
| 2026-02-05-procedural-llm-extractor-design.md | Design | Procedural LLM 추출 |
| 2026-02-05-procedural-llm-extractor-implementation-plan.md | PLAN | 동일 |
| 2025-02-05-procedural-llm-extractor-design.md | Design | 동일(이전 날짜) |
| 2026-02-05-issue57-phase2-roadmap.md | 로드맵 | Issue57 Phase2 |
| 2026-02-05-issue57-phase2-release-checklist.md | 체크리스트 | 동일 |
| 2026-02-05-issue57-phase2-B-performance-design.md | Design | Phase2 B 성능 |
| 2026-02-05-issue57-phase2-BD-implementation-plan.md | PLAN | Phase2 BD |
| 2026-02-05-issue57-phase2-D-multi-agent-design.md | Design | Phase2 D 멀티에이전트 |
| database-design-consolidation-proposal.md | 제안 | DB 설계 통합 (날짜 없음) |

---

## 2. 기능별 SDD 적용 방안

### 2.1 1단계: 이미 SPEC+PLAN+Memory Bank가 있는 기능 (이관만)

| 기능 | 현재 위치 | 이관·정리 방안 |
|------|-----------|----------------|
| **Memento CLI for AI** | design: design/memento-cli-for-ai-review.md<br>SPEC: specs/ko/2026-03-11-memento-cli-for-ai-spec.md<br>PLAN: plans/ko/2026-03-11-memento-cli-for-ai-implementation-plan.md<br>Memory Bank: plans/ko/2026-03-11-memento-cli-for-ai/ | ① 기존 폴더 `plans/ko/2026-03-11-memento-cli-for-ai/` 유지.<br>② `design/memento-cli-for-ai-review.md` → 복사 또는 이동하여 `design.md`로 둠.<br>③ `specs/ko/2026-03-11-memento-cli-for-ai-spec.md` → 동일 폴더로 이동 후 `spec.md`로 이름 변경(또는 복사 후 기존 파일은 deprecated 링크).<br>④ `plans/ko/2026-03-11-memento-cli-for-ai-implementation-plan.md` → 동일 폴더로 이동 후 `implementation-plan.md`로 이름 변경.<br>⑤ spec.md·implementation-plan.md 내부의 상대 경로(../specs/…, ../design/…)를 같은 디렉터리 기준으로 수정.<br>⑥ docs/README.md 등에서 링크를 `plans/ko/2026-03-11-memento-cli-for-ai/spec.md`, `…/implementation-plan.md`, `…/design.md`로 갱신. |

**신규 생성**: 없음. 기존 문서 이동·이름 변경·링크 수정만.

---

### 2.2 2단계: Design + PLAN이 둘 다 있는 기능 (폴더 생성 + SPEC 요약)

이미 구현이 완료되었거나 진행된 기능은 가이드 §5.2에 따라 **사후 SPEC 요약**을 두면 된다. 동일 기능으로 묶을 수 있는 design·implementation-plan을 하나의 기능 디렉터리로 모은 뒤, spec.md는 “구현 결과를 반영한 요약 명세”로 신규 작성한다.

| 기능(폴더명 제안) | 기존 문서 | 이관·신규 방안 |
|-------------------|-----------|----------------|
| **2026-03-04-monorepo-memento-core** | brainstorms/2026-03-04-monorepo-memento-core-brainstorm.md<br>plans/ko/2026-03-04-monorepo-memento-core-implementation-plan.md<br>plans/ko/2026-03-04-monorepo-phase3-thin-server-plan.md | ① `plans/ko/2026-03-04-monorepo-memento-core/` 생성.<br>② brainstorm → `design.md`로 복사 또는 이동.<br>③ implementation-plan → `implementation-plan.md`로 이동. phase3 계획은 같은 폴더에 `phase3-thin-server-plan.md`로 두거나 implementation-plan.md에 섹션으로 참조.<br>④ **신규**: `spec.md` — 범위, 목표, 요구사항(REQ)·제약(CON)·수용 기준(AC) 요약(구현 완료 상태 반영). |
| **2026-03-03-repo-cleanup** | plans/ko/2026-03-03-repo-cleanup-design.md<br>plans/ko/2026-03-03-repo-cleanup-implementation-plan.md | ① `plans/ko/2026-03-03-repo-cleanup/` 생성.<br>② design → `design.md`, implementation-plan → `implementation-plan.md`로 이동.<br>③ scripts-inventory는 같은 폴더에 `scripts-inventory.md`로 두거나 implementation-plan에서 링크.<br>④ **신규**: `spec.md` — 요약 명세(범위, REQ/CON/AC). |
| **2026-02-05-procedural-version-management** | design + implementation-plan | ① `plans/ko/2026-02-05-procedural-version-management/` 생성.<br>② design → `design.md`, plan → `implementation-plan.md` 이동.<br>③ **신규**: `spec.md` 요약. |
| **2026-02-05-procedural-llm-extractor** | design(2건)·implementation-plan | ① `plans/ko/2026-02-05-procedural-llm-extractor/` 생성.<br>② 최신 design 1건 → `design.md`, plan → `implementation-plan.md` 이동. 이전 날짜 design은 `design-2025-02-05.md` 등으로 보관 또는 링크만.<br>③ **신규**: `spec.md` 요약. |

---

### 2.3 3단계: PLAN만 있는 기능 (폴더 생성 + design/spec 최소 보강)

구현 계획만 있고 설계 문서가 없는 경우, 기능 폴더를 만든 뒤 plan을 이동하고, spec.md는 “계획서와 구현 결과를 바탕으로 한 요약”으로 최소한만 작성한다. design.md는 선택(없으면 “설계는 implementation-plan §개요”로 대체 가능).

| 기능(폴더명 제안) | 기존 문서 | 이관·신규 방안 |
|-------------------|-----------|----------------|
| **2026-02-08-issue-89-async-augmentation** | implementation-plan만 | ① `plans/ko/2026-02-08-issue-89-async-augmentation/` 생성.<br>② plan → `implementation-plan.md` 이동.<br>③ **신규**: `spec.md` — 계획서·구현 내용 기반 범위·REQ/AC 요약. design.md는 선택. |
| **2026-02-08-issue-88-fact-metadata** | implementation-plan만 | 동일 방식: 폴더 생성, plan 이동, spec.md 요약. |
| **2026-02-08-issue-90-triples-kg-dedupe** | implementation-plan만 | 동일. |
| **2026-02-07-issue-87-attribution** | implementation-plan만 | 동일. |

---

### 2.4 4단계: Design만 있거나 로드맵/제안 (폴더 생성 또는 유보)

| 문서/기능 | 유형 | 방안 |
|-----------|------|------|
| 2026-03-02-memento-growth-strategy-design | Design만 | `plans/ko/2026-03-02-memento-growth-strategy/` 생성 후 design → `design.md` 이동. spec/plan은 전략 실행 시 추가. |
| 2026-02-07-memori-inspired-design | Design만 | `plans/ko/2026-02-07-memori-inspired/` 생성 후 `design.md`로 이동. |
| 2026-02-05-remember-procedure-design | Design만 | `plans/ko/2026-02-05-remember-procedure/` 생성 후 `design.md`로 이동. |
| 2026-02-10-issue-21-meta-memory-introspection | 설계/계획 1편 | 폴더 생성 후 해당 문서를 design.md 또는 implementation-plan.md로 배치. 필요 시 spec 요약 추가. |
| 2026-02-08-issue-91-process-attribute-recall | 설계/계획 1편 | 동일. |
| issue57-phase2 (로드맵·B/D 설계·BD 계획·체크리스트) | 여러 편 | 하나의 폴더 `plans/ko/2026-02-05-issue57-phase2/`에 모으고, roadmap → design.md 또는 별도 roadmap.md, BD implementation-plan → implementation-plan.md, B/D design은 design-b.md, design-d.md 등으로 보관. spec.md는 phase2 범위 요약으로 신규 작성. |
| database-design-consolidation-proposal | 제안(날짜 없음) | `plans/ko/database-design-consolidation/` 또는 기존처럼 plans/ko 플랫 파일 유지. SDD 적용 시 폴더 생성 후 proposal → design.md, 필요 시 spec/plan 추가. |
| 2026-02-07-issue-priority-review | 검토 문서 | SDD 기능 폴더와 무관하게 plans/ko 플랫으로 두거나, 이슈 정리용 하위 디렉터리에 배치. |
| design/recall-context-saving-ideas | 아이디어 | design/에 유지하거나, 나중에 “recall-context-saving” 기능으로 SPEC/PLAN 쓸 때 `plans/ko/YYYY-MM-DD-recall-context-saving/design.md`로 옮김. |

---

### 2.5 미착수 기능 (이슈 → SDD 시작 시)

| 이슈/문서 | 방안 |
|-----------|------|
| docs/_work/issues/2026-03-13-memento-cli-skills-for-llm.md (#112) | 구현 착수 시 `docs/_work/plans/ko/2026-03-13-memento-cli-skills-for-llm/` 생성. 이슈 내용을 바탕으로 design.md → spec.md → implementation-plan.md 순으로 작성. (가이드 §5.1) |

---

## 3. 기존 문서 처리 원칙

- **이동 vs 복사**: 링크 깨짐을 피하려면 **이동**을 권장. 이동 후 기존 경로에 “이 문서는 `plans/ko/YYYY-MM-DD-기능명/파일명`으로 이관되었습니다” 리다이렉트용 짧은 md만 둘 수 있음.
- **이름 변경**: 기능 폴더 안에서는 반드시 `design.md`, `spec.md`, `implementation-plan.md`로 통일(가이드 준수).
- **내부 링크**: 이관 후 spec.md·implementation-plan.md 안의 `../specs/…`, `../design/…` 등은 같은 디렉터리 기준(예: `./design.md`, `./spec.md`)으로 수정.
- **docs/README.md·docs-classification.md**: 기능별 디렉터리 구조에 맞게 “명세·계획(SDD)” 섹션 링크를 갱신하고, 필요 시 “기능별 디렉터리 목록”을 추가.

---

## 4. 신규 문서 생성 규칙

| 문서 | 생성 시점 | 내용 |
|------|-----------|------|
| **design.md** | 기존 design/·brainstorms/ 문서를 기능 폴더로 옮길 때 해당 파일을 `design.md`로 둠. 없으면 implementation-plan의 “개요·배경”을 발췌해 최소한의 design.md 작성 가능. | 설계·브레인스토밍·배경 |
| **spec.md** | 이미 구현된 기능은 “사후 요약 명세”. 계획만 있는 기능은 계획서와 구현 결과를 바탕으로 범위, REQ/CON/AC를 요약. | 범위, 목표, REQ-*, CON-*, AC*, 메타데이터(관련 이슈, design.md 링크) |
| **implementation-plan.md** | 기존 plans/ko 플랫 파일을 해당 기능 폴더로 옮겨 `implementation-plan.md`로 둠. | Phase·Task, 검증, 기준 명세(spec.md) 링크 |

신규 작성 시 [guides/ko/sdd-workflow.md](guides/ko/sdd-workflow.md) §3·§4의 SPEC/PLAN 요건을 최소한으로 따른다.

---

## 5. 우선순위·실행 순서 제안

1. **1단계(즉시)**: Memento CLI for AI 한 건만 SDD 구조로 이관 — design/spec/plan을 `plans/ko/2026-03-11-memento-cli-for-ai/` 안으로 모으고 링크 정리. (다른 문서 참조가 많으므로 먼저 완료.)
2. **2단계**: Design+PLAN이 쌍으로 있는 기능부터 폴더 생성·이동·spec 요약 추가 (monorepo-memento-core, repo-cleanup, procedural-version-management, procedural-llm-extractor).
3. **3단계**: PLAN만 있는 이슈 단위 기능에 폴더 생성·spec 요약 (issue-87, 88, 89, 90 등).
4. **4단계**: Design만 있는 항목·로드맵/제안은 여유 있게 폴더 생성 및 design.md 이동, spec/plan은 필요 시 추가.
5. **지속**: 새 기능(#112 등)은 처음부터 `plans/ko/YYYY-MM-DD-기능명/` 아래 design.md → spec.md → implementation-plan.md 순으로 작성.

---

## 6. 요약

| 구분 | 기존 문서 정리 | 신규 생성 |
|------|----------------|-----------|
| **CLI for AI** | design, spec, plan을 기존 폴더로 이동·이름 통일, 내부 링크 수정 | design.md(design/에서 이동), 없음 |
| **Design+PLAN 있는 기능** | 기능별 폴더 생성, design/plan 이동 → design.md, implementation-plan.md | spec.md (요약 명세) |
| **PLAN만 있는 기능** | 기능별 폴더 생성, plan 이동 → implementation-plan.md | spec.md (요약), design.md (선택) |
| **Design만 / 로드맵** | 폴더 생성, design 또는 관련 문서 → design.md 등 | spec/plan은 필요 시 |
| **미착수 이슈** | — | 착수 시 기능 폴더 + design → spec → plan 순 작성 |

---

## 7. 이관 진행 현황 (2026-03-14)

| 단계 | 내용 | 상태 |
|------|------|------|
| 1단계 | Memento CLI for AI — design/spec/implementation-plan을 `plans/ko/2026-03-11-memento-cli-for-ai/`로 이관, 링크·리다이렉트 stub | 완료 |
| 2단계 | monorepo-memento-core, repo-cleanup, procedural-version-management, procedural-llm-extractor — 폴더 생성·이동·spec 요약·리다이렉트 | 완료 |
| 3단계 | issue-87, 88, 89, 90 — 폴더 생성·implementation-plan 이동·spec 요약·리다이렉트 | 완료 |
| 4단계 | memento-growth-strategy, memori-inspired, remember-procedure — 폴더 생성·design.md 이동·리다이렉트 | 완료 |
| 5단계 | issue-21(메타 메모리 인트로스펙션), issue-91(Process Attribute recall) — 구현 코드 기준 design/spec/implementation-plan 작성·폴더 이관·리다이렉트 | 완료 |
| 6단계 | issue57-phase2(로드맵·B/D 설계·BD 계획·체크리스트) — `plans/ko/2026-02-05-issue57-phase2/` 폴더 생성, roadmap/design-b/design-d/implementation-plan/release-checklist/spec 배치, 리다이렉트 stub | 완료 |
| 유보 | database-design-consolidation — 필요 시 동일 패턴으로 폴더화 | 선택 |

이 검토안대로 진행하면 “이미 개발 완료된 현 상태”가 SDD의 기능별 동일 경로(design → spec → implementation-plan)에 맞게 정리되고, 이후 신규 기능도 동일 규칙으로 추가할 수 있다.
