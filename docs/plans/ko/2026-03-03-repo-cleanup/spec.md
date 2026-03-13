# 저장소 정리 — SPEC 요약

SDD **Specify** 단계 사후 요약.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 저장소 정리 (불필요 파일·디렉터리) |
| **문서 유형** | SPECIFY (요약 명세) |
| **날짜** | 2026-03-03 |
| **설계** | [design.md](./design.md) |
| **구현 계획** | [implementation-plan.md](./implementation-plan.md) |

---

## 범위·요구사항 요약

- **범위**: 루트·scripts/·tasks/·docs·tests vs src/test/·demo/·services/ 정리. 불필요·중복·임시 항목 식별 후 삭제·이동·archive.
- **산출물**: 정리 설계 문서, (선택) file-location-audit, 변경 후 npm run build·npm test 통과, docs/README.md 링크 검증.
- **수용 기준**: 단계별 검증 가능, scripts-index·package.json·AGENTS.md 정합성 유지.

**다음 단계**: [implementation-plan.md](./implementation-plan.md)
