# PR #104 Developer Continuity Assistant Phase 1 코드 리뷰

**일자**: 2026-03-01  
**PR**: #104 — Feature/developer continuity assistant phase1  
**브랜치**: `feature/developer-continuity-assistant-phase1` → `main`  
**범위**: Base `db07415` .. Head `3359b76` (57 files, +5050/-7)

---

## 1. 요약

- **평가**: **With fixes** — Important 1건(`parseOriginSource` 예외 처리) 반영 후 머지 권장.
- **Critical**: 없음.
- **Important**: 2건 (parseOriginSource 안전 처리, 루트 lint에 packages 포함).
- **Minor**: 3건 (unknown tool 404, CLI 성공 메시지, recall 응답 형태 주석).

---

## 2. Strengths (잘된 점)

- **패키지 경계**: `memento-core`(퍼사드 + HTTP 툴 클라이언트)와 `memento-assistant`(continuity 도구, 세션/체크포인트/리줌, CLI, HTTP 서버)가 명확히 분리되어 있고, core는 assistant를 참조하지 않음.
- **요구사항 반영**: `start_session`, `save_context`, `end_session`, `resume_session` 4종 구현; `end_session`에 `branch` 포함; `runtime-core-bridge`에서 **strict branch-safe** 필터링(branch 지정 시 `origin_source.branch` 일치만).
- **공유 타입**: `RememberParams` / `CreateMemoryParams`에 `process_id`, `session_id`, `origin_source` 등 continuity 속성 추가로 계약 일치.
- **테스트**: packages 단위/통합 28개 통과; branch 필터, continuity-metadata, SessionCheckpointService, ResumeSnapshotService, 4개 도구, AssistantClient, continuity-cli 등 커버; E2E로 cross-branch 격리 검증.
- **빌드/검증**: `validate-workspace.mjs`, 루트 `type-check`에 workspace 포함, `vitest.config.ts`에 `packages/**` 포함.
- **도구 설계**: Zod 스키마 입력 검증, `BaseTool` 공통화, `AssistantToolRegistry`로 등록/실행 일원화.

---

## 3. Issues

### 3.1 Important (반영 권장)

#### 1. `parseOriginSource` — 문자열 파싱 예외 처리 누락

- **파일**: `packages/memento-assistant/src/continuity/services/continuity-metadata.ts`
- **문제**: `typeof raw === 'string'`일 때 `JSON.parse(raw)`만 사용. DB/레거시에서 잘못된 JSON 문자열이 오면 예외가 나서 `queryContinuityMemories` 전체가 실패할 수 있음.
- **수정 제안**:
```ts
if (typeof raw === 'string') {
  try {
    return JSON.parse(raw) as ContinuityOriginSource;
  } catch {
    return {};
  }
}
```

#### 2. 루트 `package.json` — lint 범위에 packages 미포함

- **파일**: `package.json` (현재 `"lint": "eslint src/**/*.ts"`)
- **문제**: `packages/memento-core`, `packages/memento-assistant`가 린트 대상이 아님.
- **수정 제안**: `"lint": "eslint src/**/*.ts packages/**/src/**/*.ts"`로 확장하거나, workspace별 `npm run lint`를 루트에서 호출.

### 3.2 Minor (선택)

3. **assistant-http-server.ts** — 알 수 없는 도구명을 400 대신 404로 반환 검토.  
4. **continuity-cli.ts** — start/save/end 성공 시 "Session started.", "Context saved.", "Session ended." 등 짧은 메시지 출력 검토.  
5. **http-tool-client.ts** — `data.result.items` vs `data.result.items?.items` 처리 이유를 한 줄 주석으로 명시 검토.

---

## 4. Recommendations

- **반드시**: `parseOriginSource`에서 문자열 파싱 시 try/catch 추가.
- **권장**: 루트 lint에 `packages/**` 포함(이번 PR 또는 별도 PR).
- **선택**: unknown tool → 404, CLI 성공 메시지, recall 응답 형태 주석.

---

## 5. Assessment

**Ready to merge?** **With fixes**

- 기능·아키텍처·테스트·타입은 계획/가이드와 일치하고, 브랜치 격리·저장/조회 계약이 잘 맞음.
- **Important #1**(`parseOriginSource` 예외 처리) 반영 후 머지 권장.
- **Important #2**(lint에 packages 포함)는 이번 PR 또는 별도 PR로 진행 가능.
- Critical 이슈 없음.
