# 개발 및 AI 협업 규칙 (Development & AI Collaboration Rules)

이 문서는 Memento 프로젝트의 코딩 표준, 아키텍처 원칙, 그리고 AI 에이전트와의 협업 가이드라인을 정의합니다.

## 1. 핵심 설계 원칙: "Functional Core, Structured Shell"
AI가 코드를 정확히 이해하고 검증할 수 있도록 비즈니스 로직과 시스템 구조를 명확히 분리합니다.

### Functional Core (비즈니스 로직: 함수형)
*   **순수 함수(Pure Functions):** 모든 핵심 로직(`memento-core/src/domains/`)은 외부 상태에 의존하지 않는 순수 함수로 작성합니다.
*   **불변성(Immutability):** 데이터 구조를 직접 수정하지 않고 항상 새로운 객체를 반환합니다.
*   **단일 책임(SRP):** 함수는 작고 명확한 하나의 작업만 수행하여 AI의 문맥 파악 효율을 높입니다.

### Structured Shell (시스템 구조: 객체지향/모듈형)
*   **인터페이스 기반 설계:** 외부 시스템(DB, API) 연동은 인터페이스와 클래스로 구조화합니다.
*   **의존성 주입(DI):** 테스트 용이성을 위해 의존성을 외부에서 주입받습니다.
*   **합성 우선(Composition):** 깊은 상속 계층 대신 합성을 사용하여 구조를 평평하게 유지합니다.

### 소프트웨어 설계 3원칙 (YAGNI · KISS · DRY)

*   **YAGNI (You Aren't Gonna Need It):** 지금 당장 필요하지 않은 기능은 구현하지 않습니다. 미래의 가상 요구사항을 위한 추상화·확장 포인트·플래그는 실제 필요가 생길 때 추가합니다.
*   **KISS (Keep It Simple, Stupid):** 가장 단순한 해법을 우선합니다. 복잡성을 도입하기 전에 "더 단순하게 풀 수 없는가?"를 반드시 자문합니다. 유사한 세 줄의 코드가 섣부른 추상화보다 낫습니다.
*   **DRY (Don't Repeat Yourself):** 지식(로직·규칙·데이터 구조)은 한 곳에만 존재해야 합니다. 단, 우연한 중복(코드가 비슷하지만 의미가 다른 경우)은 억지로 통합하지 않습니다.

---

## 2. 아키텍처 및 기술 스택

### 의존성 규칙
*   **의존성 방향:** `shared` ← `domains` ← `infrastructure`
*   **패키지 간 참조:** `core` ← `server`, `core` ← `client`. 반대 방향(순환 참조)은 금지됩니다.
*   **도메인 기반 구조:** 코드는 비즈니스 도메인 단위로 조직화하며, 도메인 간 독립성을 최대한 유지합니다.

### 핵심 기술 스택
*   **Runtime:** Node.js ≥ 24 (ES Modules).
*   **Language:** TypeScript 5.x (Strict mode).
*   **Database:** SQLite (`better-sqlite3`).
*   **Backend:** Express 5.x, Zod (Validation).
*   **Testing:** Vitest.

---

## 3. 코딩 스타일 및 컨벤션

### 기본 스타일
*   **포맷팅:** 2칸 들여쓰기, 작은따옴표('), 세미콜론(;) 사용, 후행 쉼표 사용.
*   **네이밍:**
    *   파일명/디렉토리: `kebab-case`
    *   클래스: `PascalCase`
    *   함수/변수: `camelCase`

### 로깅 및 보안
*   **로깅:** `console.log` 사용 금지. 전용 `logger`를 사용하며 구조화된 JSON 로그를 지향합니다.
*   **보안:** PII(개인정보) 마스킹 필수. DB 타임스탬프는 항상 **UTC (ISO 8601)**를 사용합니다.

---

## 4. AI 에이전트 전용 지침 (Specialized Agent Rules)

### MCP 및 메모리 관리
*   **작업 전:** `recall` 또는 `memory_injection`으로 과거 컨텍스트를 반드시 조회합니다.
*   **메모리 타입:** `working`(작업중), `episodic`(사건), `semantic`(지식), `procedural`(절차)을 구분하여 저장합니다.

### Serena 및 도구 활용
*   **심볼 기반 탐색:** 파일 전체를 읽기 전 `get_symbols_overview`를 사용하여 필요한 부분만 타겟팅합니다.
*   **중복 방지:** 동일 파일에 대해 한 턴에 여러 번 `replace`를 호출하지 않습니다.

### Knowledge Graph (graphify)
*   **분석 우선:** 코드베이스 구조나 아키텍처를 분석할 때는 먼저 `graphify-out/GRAPH_REPORT.md`에서 god nodes와 community 구조를 확인합니다.
*   **위키 우선:** `graphify-out/wiki/index.md`가 있으면 원시 파일을 광범위하게 읽기 전에 해당 위키를 먼저 탐색합니다.
*   **갱신 의무:** 코드 수정 후 반드시 지식 그래프 재빌드 명령을 실행합니다.
    `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

---

## 5. 워크플로우 및 품질 관리

### 브랜치 및 커밋 전략
*   **브랜치 명명:** `feature/*`, `fix/*`, `docs/*`, `chore/*` 형식을 따릅니다.
*   **커밋 메시지:** Conventional Commits 준수. **한국어 설명 포함**을 강력히 권장합니다.
    *   예: `feat(search): 하이브리드 검색 엔진 추가`
*   **Pull Request:** 원격에 처음 올리는 PR은 **Draft PR**로 등록합니다. CI 통과, 셀프 리뷰, 설명·체크리스트 정리가 끝난 뒤 Ready for review로 전환합니다. (예: GitHub CLI `gh pr create --draft`)

### 문서화 원칙
*   **한국어 우선:** 모든 문서는 한국어를 기본으로 작성하며, 필요시 영어로 번역합니다.

### 테스트 가이드 (AAA 패턴)
```typescript
it('should behavior when condition', async () => {
  // Arrange: 데이터 준비
  // Act: 기능 실행
  // Assert: 결과 검증
});
```

### 품질 게이트
*   **검증 필수:** 커밋 전 `lint`, `type-check`, `test` 통과가 필수입니다.
*   **실패 우선 테스트:** 버그 수정 시, 버그 재현 테스트를 먼저 작성합니다.

### 선택적 정적 스캔 (slop-detector)
*   **도구:** PyPI 패키지 `ai-slop-detector`, CLI `slop-detector`.
*   **설치:** `pip install ai-slop-detector`
*   **권장 명령(저장소 루트):**
    *   패키지 소스: `slop-detector --project packages --js --config .slopconfig.yaml`
    *   대시보드 정적 스크립트: `slop-detector --project static/js --js --config .slopconfig.yaml`
    *   루트 전체(설정 반영): `slop-detector --project . --js --config .slopconfig.yaml`
*   **`--gate`:** 상단 요약에 Python/LDR가 0으로 보일 수 있다. **`--js` 사용 시 JS/TS Analysis 구간을 게이트 판단의 주된 근거로 본다.**
*   **CI:** 본 저장소의 필수 CI 게이트에는 포함하지 않는다(후속 이슈에서 선택).
*   **테스트 경로 무시:** 기본 `.slopconfig`에서는 `*.spec.ts` 등을 대량 제외하지 않는다. 팀 정책에 따라 로컬에서만 ignore를 추가할 수 있다.
