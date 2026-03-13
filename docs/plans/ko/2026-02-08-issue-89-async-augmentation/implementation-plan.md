# 비동기 Augmentation 파이프라인 구현 계획 (Issue #89)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 대화/이벤트는 지연 없이 즉시 저장하고, Fact/Triple/요약/중복제거/콘솔리데이션은 백그라운드 워커에서 수행하는 파이프라인을 명시적으로 도입·문서화한다.

**Architecture:** (1) MCP remember/remember_procedure 응답은 메모리 DB 저장 직후 반환(append-only 즉시 저장). (2) Triple 추출·콘솔리데이션 점수 등 augmentation은 BatchScheduler의 JobQueue 및 주기 배치로만 수행. (3) 기존 BatchScheduler·TripleExtractionBatchJob·ConsolidationScoreWorker와 동일한 인프라를 “비동기 Augmentation 파이프라인”으로 정리하고, 즉시 저장 경로에서 블로킹/폴백을 제거한다.

**Tech Stack:** TypeScript, 기존 BatchScheduler/JobQueue/RetryManager, Vitest.

---

## Task 1: 즉시 저장 경로 명시 및 문서화

**Files:**
- Modify: `src/domains/memory/tools/remember-tool.ts` (주석/로직 정리)
- Create: `docs/architecture/async-augmentation-pipeline.md` (선택, 아키텍처 문서)

**Step 1: 문서 작성 (선택)**

- `docs/architecture/async-augmentation-pipeline.md` 생성:
  - “즉시 저장”: remember/remember_procedure 호출 시 메모리 항목을 DB에 append-only로 저장하고, 응답은 저장 직후 반환. augmentation 완료를 기다리지 않음.
  - “워커 정제”: Triple 추출(per-item JobQueue + TripleExtractionBatchJob), 콘솔리데이션 점수(ConsolidationScoreWorker), 관계 검증 등은 BatchScheduler에서 배치/큐 기반 실행.
  - 기존 batch-scheduler.ts, triple-extraction-batch-job.ts, consolidation-score-worker.ts 참조.

**Step 2: remember-tool 즉시 저장 주석 보강**

- remember-tool.ts에서 메모리 저장이 완료된 직후(episodic/semantic 등 DB write 성공 후) “즉시 저장 완료, augmentation은 워커에서 비동기 수행”을 명시하는 JSDoc 또는 상단 주석 추가.
- 기존 동작 변경 없이 주석만 추가 가능.

**Step 3: Commit**

```bash
git add src/domains/memory/tools/remember-tool.ts [docs/architecture/async-augmentation-pipeline.md]
git commit -m "docs(89): clarify immediate-save path and async augmentation pipeline"
```

---

## Task 2: Triple 추출 폴백 제거 — 순수 비동기 경로로 통일

**Files:**
- Modify: `src/domains/memory/tools/remember-tool.ts`

**Step 1: Write the failing test**

- Given: 프로덕션 환경(또는 isTestEnvironment() === false 모킹), remember 호출로 episodic 저장 후 triple 추출이 addJob으로만 등록됨
- When: addJob 직후 2초 이내에 다른 작업이 해당 job을 소비하지 않음
- Then: 2초 후 setTimeout 폴백이 **실행되지 않음** (순수 비동기: 큐/배치만 담당)
- 테스트: `remember-tool.spec.ts`에 “비동기 augmentation 시 폴백 미실행” 시나리오 추가. 폴백 제거 전에는 “폴백이 실행됨”으로 기대값 설정 후, 구현 변경 시 “폴백 미실행”으로 수정.

**Step 2: Run test to verify it fails**

```bash
npm test -- src/domains/memory/tools/__tests__/remember-tool.spec.ts -v -t "async augmentation"
```

Expected: 실패 또는 해당 테스트가 “폴백 실행”을 기대하는 상태에서 통과.

**Step 3: Implement**

- remember-tool.ts에서 `setTimeout(async () => { ... }, 2000)` 폴백 블록 제거. 단, 테스트 환경(isTestEnvironment())에서는 기존처럼 tripleExtractionJob() 즉시 실행 유지.
- 또는 설정 플래그(예: `config.asyncAugmentationOnly`)로 폴백 비활성화 후, 기본값을 true로 두어 폴백 미실행.

**Step 4: Run test to verify it passes**

- 위 테스트를 “폴백 미실행”으로 수정 후 실행.
- 기존 remember-tool 관련 테스트 전부 실행하여 회귀 없음 확인.

```bash
npm test -- src/domains/memory/tools/__tests__/remember-tool.spec.ts -v
```

**Step 5: Commit**

```bash
git add src/domains/memory/tools/remember-tool.ts src/domains/memory/tools/__tests__/remember-tool.spec.ts
git commit -m "feat(89): remove 2s fallback for triple extraction; pure async augmentation"
```

---

## Task 3: BatchScheduler “비동기 Augmentation” 역할 문서화 및 설정 정리

**Files:**
- Modify: `src/infrastructure/scheduler/batch-scheduler.ts` (파일 상단 또는 클래스 JSDoc)
- Modify: `config/` 또는 환경 변수 문서 (필요 시)

**Step 1: 문서화**

- batch-scheduler.ts 상단에 JSDoc 또는 주석 추가:
  - 이 스케줄러가 “비동기 Augmentation 파이프라인”의 워커 역할을 담당함.
  - 담당 작업: (1) Per-item Triple 추출(JobQueue), (2) Triple 추출 배치(TripleExtractionBatchJob), (3) 콘솔리데이션 점수(ConsolidationScoreWorker), (4) 관계 검증, (5) 품질 측정, (6) 메모리 정리 등.
  - 실패 재시도: RetryManager. 모니터링: 기존 로깅·메트릭.

**Step 2: Commit**

```bash
git add src/infrastructure/scheduler/batch-scheduler.ts
git commit -m "docs(89): document BatchScheduler as async augmentation pipeline worker"
```

---

## Task 4: 실패 재시도·모니터링 요약 문서

**Files:**
- Create or Modify: `docs/architecture/async-augmentation-pipeline.md` (또는 기존 운영 문서)

**Step 1: 내용 추가**

- 비동기 augmentation 실패 시 재시도: JobQueue + RetryManager (retryAttempts, retryDelay 등 BatchJobConfig).
- Triple 추출 배치 실패: TripleExtractionBatchJob 내부 재시도·triple_extracted_status 업데이트.
- 모니터링: BatchScheduler 로그, getStatus(), admin 라우트(있다면)에서 큐/실행 상태 확인 가능함을 한 줄로 기술.

**Step 2: Commit**

```bash
git add docs/architecture/async-augmentation-pipeline.md
git commit -m "docs(89): document retry and monitoring for async augmentation"
```

---

## 범위 참고 (이슈 #89에서 미구현으로 둘 수 있는 항목)

- **Fact 추출**: 현재 “Fact”는 Issue #88에서 메타데이터(num_times, last_mentioned_at 등)로 정규화됨. 대화에서 Fact를 “추출”하는 전용 단계는 별도 이슈/PR에서 도입 가능. 본 계획에서는 워커 파이프라인에 “Fact 추출” 슬롯만 문서로 언급.
- **요약**: 에피소드 요약 생성이 별도 서비스로 있다면 동일하게 JobQueue/배치에 등록하는 패턴 적용. 없으면 생략.
- **중복제거(dedupe)**: Issue #90 (Triple/KG dedupe) 및 기존 consolidation과 연동. 본 이슈에서는 “워커에서 수행”만 명시.

---

## 실행 옵션

계획 저장 완료. 다음 두 가지 실행 방식을 선택할 수 있습니다.

**1. Subagent-Driven (이번 세션)**  
작업 단위마다 서브에이전트를 호출하고, 태스크 간에 코드 리뷰를 하며 빠르게 반복합니다.  
→ **REQUIRED SUB-SKILL:** superpowers:subagent-driven-development

**2. Parallel Session (별도 세션)**  
새 세션을 열고 executing-plans 스킬로 체크포인트 단위 배치 실행.  
→ 새 세션에서 superpowers:executing-plans 사용

어떤 방식으로 진행할까요?
