# Memento CLI for AI 가이드

AI 에이전트가 Memento 기억을 사용할 때 CLI로 `recall`, `remember`, `forget`, `memory_injection`을 실행할 수 있습니다.

---

## 1. 명령 목록

| 명령 | 설명 |
|------|------|
| `recall` | 관련 기억을 검색합니다 (하이브리드 검색) |
| `remember` | 기억을 저장합니다 |
| `forget` | 기억을 삭제합니다 (소프트/하드) |
| `memory_injection` | 관련 기억을 요약하여 프롬프트에 주입 |

---

## 2. 워크플로

- **작업 전**: `recall` 또는 `memory_injection`으로 관련 기억을 조회해 컨텍스트로 활용합니다.
- **작업 후**: `remember`로 완료 기록(episodic), 재사용 지식(semantic), 절차(procedural)를 저장합니다.
- 앵커를 쓰는 경우 MCP의 `search_local`과 동일한 데이터를 CLI에서는 `recall`로 조회할 수 있습니다.

---

## 3. 설정 방법

- **DB 경로**: `DB_PATH` 환경 변수, 또는 `--db-path <path>` 옵션.  
  기본값은 core 설정(`mementoConfig.dbPath`)이며, 보통 `.env` 또는 `~/.memento/.env`에서 설정합니다.
- **.env 탐색 순서**:  
  1) `--env-file`로 지정한 파일  
  2) `--config-dir` 또는 `MEMENTO_CONFIG_DIR` 내 `.env`  
  3) 현재 작업 디렉터리 `.env`  
  4) `~/.memento/.env`
- **npx 반복 사용**: 매번 `npx`로 실행하면 다운로드가 발생할 수 있으므로, 반복 사용 시 글로벌 설치(`npm i -g memento-mcp-server`) 또는 로컬 설치 후 `./node_modules/.bin/memento` 사용을 권장합니다.

---

## 4. 예제 호출

### recall (검색)

```bash
memento recall --query "프로젝트 결정 사항" --limit 5
memento --db-path /path/to/db.db recall --query "test" --limit 2
```

성공 시 stdout에 JSON (예: `{"items":[...],"total_count":n,...}`), exit code 0.

### remember (저장)

```bash
memento remember --content "작업 완료: API 스펙 확정" --type episodic --tags completed,api
```

성공 시 stdout에 `memory_id` 등이 포함된 JSON, exit code 0.

### forget (삭제)

```bash
memento forget --id mem_xxxxx
memento forget --id mem_xxxxx --hard --confirm true
```

### memory_injection (컨텍스트 주입)

```bash
memento memory_injection --query "이전에 논의한 보안 정책" --token_budget 1000
```

---

## 5. 출력 규칙 (REQ-IO-4, AC8)

- **성공 시**: **stdout에 JSON만** 출력됩니다. Memento core·라이브러리 로그(INFO, WARN, DEBUG)는 CLI 모드에서 억제되어 stdout·stderr에 일상 로그가 섞이지 않습니다. (AI·스크립트가 stdout만 파싱해 사용할 수 있음.)
- **실패 시**: **stderr**에 에러 메시지가 출력되고 **exit code non-zero**입니다.
- 참고: onnxruntime 등 서드파티 라이브러리가 stderr에 직접 출력하는 메시지는 환경에 따라 보일 수 있습니다.

---

## 6. 검증 체크리스트 (AC5, AC6)

- **AC5**: `memento --db-path /tmp/memento-cli-ac5.db recall --query "x" --limit 1` 실행 시 지정한 path의 DB가 사용되는지 확인 (해당 DB에 데이터가 있으면 그 결과가 stdout에 나와야 함).
- **AC6**: `~/.memento/.env`에 `DB_PATH=<path>`만 두고 cwd에 `.env`가 없을 때, `memento recall --query "x" --limit 1` 실행 시 해당 DB_PATH가 적용되는지 확인.

---

## 7. 참고

- 명세: [specs/ko/2026-03-11-memento-cli-for-ai-spec.md](../../specs/ko/2026-03-11-memento-cli-for-ai-spec.md)
- 구현 계획: [plans/ko/2026-03-11-memento-cli-for-ai-implementation-plan.md](../../plans/ko/2026-03-11-memento-cli-for-ai-implementation-plan.md)
- 이슈: [#110](https://github.com/jee1/memento/issues/110)
