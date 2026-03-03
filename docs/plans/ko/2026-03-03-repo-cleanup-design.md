# 저장소 정리 설계 (불필요 파일·디렉토리)

**일자**: 2026-03-03  
**목적**: 유지보수성·문서 정합성·빌드·CI/검색을 모두 고려한 전반 정리. 작업 흔적·중복·임시 항목을 정리하고 단계별로 검증 가능하게 한다.

---

## 1. 범위·산출물

### 1.1 범위

- **루트**: 작업 흔적·중복·임시성 파일·디렉터리 식별 후 삭제 또는 적절 위치 이동  
  (예: `PR_DESCRIPTION.md` vs `pr-description.md`, `mcp-http-client.js`, `test-docker.js`, `test-config/`, `test-logs/`, `config/` 등)
- **scripts/**: npm/문서에 등록된 항목·운영 필수(마이그레이션·백업 등)는 유지, 일회성·미참조는 `scripts/archive/` 이동 또는 삭제. `scripts-index.md`·`package.json`과 정합성 유지.
- **tasks/**: PRD·태스크 브레이크다운 체계 유지. 메타 가이드(`create-prd.md` 등)는 `docs/`로 이동 또는 한곳으로 모음. 폐기 PRD는 archive 정책만 문서화(실제 이동은 선택).
- **문서**: `docs/README.md`의 깨진 링크 수정. 누락된 `file-location-audit.md`, `2026-02-28-file-location-audit-improvements.md`는 “해당 문서 없음” 안내로 링크 수정하거나, 이번 정리 설계를 반영한 최소 문서 생성.
- **tests/ vs src/test/**: 역할 정의(통합/픽스처 vs E2E)를 `AGENTS.md` 또는 `docs/guides`에 명시. 디렉터리 통합은 선택(이번 설계에서는 역할만 정의).
- **demo/**, **services/**: 사용 여부·빌드 산출물 확인 후 유지·이동·archive 결정. `.gitignore`에 빌드 산출물(`demo/.next`, `demo/node_modules` 등) 반영.

- **config/, static/, prompts/** (루트): 유지. `copy-assets`가 config·prompts를 dist로 복사, HTTP 서버가 static을 서빙(dashboard 등).

### 1.2 산출물

- 정리 설계 문서: 본 문서 (`docs/plans/ko/2026-03-03-repo-cleanup-design.md`)
- (선택) `docs/reference/ko/file-location-audit.md` 최소 버전 또는 “문서 없음” 안내
- 변경 후: `npm run build`·`npm test` 통과, `docs/README.md` 링크 검증

---

## 2. 단계별 작업·우선순위

| 단계 | 작업 | 우선순위 | 검증 |
|------|------|----------|------|
| **1** | 루트 작업 흔적 정리: `PR_DESCRIPTION.md`/`pr-description.md` 중복, `mcp-http-client.js`, `test-docker.js`, `test-anchor-map-ui.sh` 등 필요 여부 판단 후 삭제 또는 `docs/operations` 등으로 이동 | 높음 | `npm run build` 유지 |
| **1** | `.gitignore` 보강: `test-config/`, `test-logs/`, `test-results/`, `logs/`, `coverage/`, `demo/.next`, `demo/node_modules`, `.worktrees` 등 | 높음 | 빌드/CI·검색 노이즈 감소 |
| **1** | 루트 `config/`, `static/`, `prompts/` 역할 확인 후 유지 또는 `src/`/문서로 정리 | 중간 | AGENTS.md/README와 일치 |
| **2** | `scripts/` 인벤토리: npm/문서 등록·운영 필수만 유지, 나머지 `scripts/archive/` 이동 또는 삭제 후 `scripts-index.md`·`package.json` 반영 | 높음 | `npm run build`·주요 npm 스크립트 동작 |
| **2** | `tasks/` 정리: 메타 가이드를 `docs/plans/ko/` 또는 `tasks/` 내 한 디렉터리로 모음; 폐기 PRD archive 정책 문서화 | 중간 | docs/README 링크 일관성 |
| **3** | 문서 정합성: `docs/README.md`에서 `file-location-audit.md`, `2026-02-28-file-location-audit-improvements.md` 링크 수정 또는 대체 문서 생성 | 높음 | 링크 클릭 시 404 없음 |
| **3** | `tests/` vs `src/test/` 역할을 AGENTS.md 또는 `docs/guides`에 명시 | 낮음 | 신규 기여자 이해 용이 |
| **3** | `demo/`, `services/` 사용 여부·빌드 산출물 확인 후 유지/이동/archive 결정 및 `.gitignore` 반영 | 중간 | 저장소 일관성 |

우선순위: 1단계(루트·gitignore) → 2단계(scripts·tasks) → 3단계(문서·tests·demo·services). 각 단계 끝에 `npm run build`·`npm test`로 검증.

---

## 3. 예외·리스크

### 3.1 예외

- `packages/` 내부 구조는 이번 정리 범위 제외(별도 리팩터링 시 다룸).
- `data/`, `dist/`, `node_modules` 등 이미 `.gitignore`에 있는 항목은 “정리” 대상이 아님.
- PRD·태스크 본문 삭제는 하지 않음. 메타 가이드 이동·archive 정책만 적용.

### 3.2 리스크

- **scripts 이동/삭제**: 외부·CI·문서에서 `scripts/xxx` 경로를 참조할 수 있음. 인벤토리 단계에서 참조 검색 후, 필요 시 `scripts/archive/`로 이동하고 `scripts-index.md`에 “이전 경로 → archive” 안내 추가.
- **문서 링크**: 누락 문서를 “문서 없음”으로만 수정하면 링크는 유지되나 내용이 비어 있음. 이번 설계를 요약한 최소 문서를 두면 검색·유지보수에 유리함.

---

*구현 계획은 `2026-03-03-repo-cleanup-implementation-plan.md` 참고.*
