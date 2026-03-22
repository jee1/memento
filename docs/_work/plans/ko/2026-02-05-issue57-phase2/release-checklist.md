# Issue #57 Phase 2 배포·마이그레이션 체크리스트

**대상 브랜치**: `feat/remember-procedure` (Phase 2 B·D·remember_procedure)  
**관련 PR**: `pr-description.md` 참고

---

## 머지 전

- [ ] `npm run type-check` 통과
- [ ] `npm run lint -- --fix` 통과
- [ ] `npm test` (또는 최소한 014/015 마이그레이션 + remember/recall 관련 스펙) 통과
- [ ] CHANGELOG [Unreleased] 반영 확인
- [ ] PR 설명에 배포 관련 항목 기입 확인

---

## 머지 후 / 배포 시

1. **데이터베이스 마이그레이션**
   - 마이그레이션 **014** (procedural version 인덱스), **015** (`memory_item.owner_id`) 자동 적용
   - 서버 기동 시 자동 마이그레이션 사용 시 별도 조치 없음
   - 수동 적용 시: `npm run db:migrate` (또는 프로젝트에서 정의한 마이그레이션 실행 방식)

2. **환경 변수 (선택)**
   - recall 성능 프로파일링이 필요할 때만: `MEMENTO_RECALL_PROFILE=1` 설정
   - 미설정 시 동작 변경 없음

3. **의존성**
   - 새 의존성 없음. `npm install`만 유지하면 됨.

---

## 롤백

- DB 스키마에 인덱스·컬럼이 추가된 형태이므로, 롤백 시에는 이전 버전 코드로 되돌린 뒤 **마이그레이션 down**이 정의되어 있으면 실행. (현재 014/015는 up만 구현된 경우가 많으므로, 필요 시 수동으로 인덱스/컬럼 제거 검토.)

---

## 관련 문서

- [recall 성능 튜닝](../../../../guides/ko/recall-performance-tuning.md) — recall 프로파일링 사용법
- [다중 에이전트 사용](../../../../guides/ko/multi-agent-usage.md) — owner_id / 다중 에이전트 사용법
