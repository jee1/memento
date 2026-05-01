# 설계: 이슈 #214 — memento-core Wave 1 부트스트랩 조립 분리

**상태**: 승인됨 (브레인스토밍 2026-05-01)  
**날짜**: 2026-05-01  
**관련**: [GitHub #214](https://github.com/jee1/memento/issues/214), 부모 [#180](https://github.com/jee1/memento/issues/180), 로드맵 `docs/superpowers/specs/2026-05-01-issue-180-refactor-roadmap-design.md`

---

## 1. 목적

`packages/memento-core/src/bootstrap.ts`의 `initializeServices`에 집중된 **과도한 중첩·단일 파일 부담**을 줄인다. **런타임 동작·공개 계약은 변경하지 않는다** (리팩터만).

---

## 2. 범위

| 포함 | 제외 |
|------|------|
| `packages/memento-core/src/bootstrap.ts` 및 분리를 위해 추가하는 `packages/memento-core/src/bootstrap/**/*.ts` | Wave 2(거대 spec 분할), Wave 3(`any` 정리) |
| `ServerServices` 타입과 `initializeServices`의 반환 필드·초기화 순서 **동일 유지** | DB 스키마·마이그레이션·`initializeDatabase` 로직 변경 (`infrastructure/database/database/init.ts`는 대상 아님) |
| `packages/memento-server/src/server/bootstrap.ts`는 **읽기 점검만** (현재는 `@memento/core` 재수출만 존재 → 코드 변경 없음) | 기능 추가, 설정 키 추가 |

---

## 3. 아키텍처 방향

- **권장 구조**: `packages/memento-core/src/bootstrap/` 하위에 **이름 있는 단위**(앵커 스택, 실패/리플렉션, 모니터링·WAL·락, 쓰기 병합·메타, 배치·텔레메트리·관계·슬립, 런타임 진단 샘플러 등)로 분리한다.
- 루트 `bootstrap.ts`는 **공개 API**(`ServerServices`, `initializeServices`)와 얇은 오케스트레이션만 남긴다.
- `@memento/core` 패키지 **외부로의 import 경로**는 기존과 동일하게 유지한다 (`./bootstrap.js` 경유 re-export는 `index.ts` 등 기존과 동일).

---

## 4. 데이터 흐름·계약

- `createMementoCore` (`packages/memento-core/src/index.ts`)는 계속 `initializeDatabase` 후 `initializeServices(db)`를 호출한다.
- `initializeServices`는 단일 `Database.Database` 인스턴스를 받아, 기존과 동일한 순서로 부수 효과(큐 시작, `restoreCacheFromDB`, 스케줄러 `start`, 배치 스케줄러 `start` 등)를 수행한다.
- 새 전역 싱글톤을 도입하지 않는다.

---

## 5. 오류 처리

- 최상위 `try/catch`에서 `서비스 초기화 실패: …` 메시지로 래핑하는 **기존 패턴을 유지**한다.
- 진단 샘플러 등 best-effort 경로는 기존과 같이 부트스트랩 중단을 유발하지 않는다.

---

## 6. 검증

- `npm run lint`
- `npm run type-check`
- `npm test`
- (선택) 해당 패키지 스모크: 이슈 완료 조건에 부합하는 한 **CI와 동일한 명령으로 충분**하다.

---

## 7. 스펙 자체 점검

- **Placeholder**: 없음.
- **모호성**: `initializeDatabase`는 본 웨이브 대상이 아님을 본 문서 §2에 명시함.
- **범위**: 단일 PR·단일 웨이브에 적합.
