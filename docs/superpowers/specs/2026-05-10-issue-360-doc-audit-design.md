# 이슈 #360 문서 감사 설계: docs 포털 메타·DESIGN·Cursor 규칙

## 개요

이슈 #357 에픽의 서브이슈로, `docs/` 포털 메타 문서·DESIGN 문서·Cursor 규칙 5개 파일을 현재 코드베이스와 정합시킨다.

## 범위

### 대상 파일

| 파일 | 분류 | 작업 |
|------|------|------|
| `docs/README.md` | 사람 유지 (SSOT) | 포털 표 링크 전수 확인, 실제 파일과 불일치 수정 |
| `docs/docs-classification.md` | 사람 유지 (SSOT) | `docs/` 디렉토리 트리와 매핑 표 비교, 불일치 수정 |
| `docs/DESIGN.md` | 사람 유지 (SSOT) | 참조 경로(`static/css/`) 존재 확인, 내용 구조 정합 확인 |
| `docs/blog/README.md` | 사람 유지 (SSOT) | 참조 링크 갱신 또는 현 상태 유지 |
| `.cursor/rules/specify-rules.mdc` | 자동 생성 | 수동 편집 금지, 플랜·훅과 메타 정합성만 확인 |

### 제외 범위

- `docs/superpowers/**`, 루트 `specs/`, `tasks/` — 스냅샷이므로 수정 금지
- CSS 토큰 값 심층 검증 등 UI 코드 작업
- `.cursor/rules/specify-rules.mdc` 내용 수정 (자동 생성분, 재생성으로만 갱신)

## 완료 조건

- 포털 표(`docs/README.md`)의 모든 링크가 실제 파일에 연결됨
- `npm run docs:audit-links` 통과 (깨진 링크 0건)

## 워크플로

`docs/operations/ko/doc-audit-workflow.md` 절차를 따른다.

```bash
# 1. worktree 생성
git fetch origin
git worktree add ../memento-docs-360 origin/main
cd ../memento-docs-360

# 2. 전용 브랜치
git switch -c docs/issue-360

# 3. 파일별 검토·수정

# 4. 검증
npm run docs:audit-links

# 5. 커밋·PR
```

## 파일별 검토 기준

### `docs/README.md`

- 포털 표의 각 링크가 실제 파일(`guides/ko/`, `guides/en/`, `api/ko/` 등)에 연결되는지 확인
- 존재하지 않는 파일 링크 → 경로 수정 또는 행 제거
- 최근 추가된 문서 중 포털에 누락된 항목 추가

### `docs/docs-classification.md`

- 섹션 4 "디렉터리 → 카테고리 매핑" 표를 실제 `docs/` 트리와 비교
- 삭제된 경로나 신규 경로가 있으면 표 갱신

### `docs/DESIGN.md`

- `static/css/tokens.css`, `static/css/components.css` 경로 존재 여부 확인
- 파일이 없으면 경로 수정 또는 참조 제거
- 내용 구조(토큰 이름, 컴포넌트 클래스)는 실제 CSS와 대조 (단, 전수 검증 불포함)

### `docs/blog/README.md`

- `CHANGELOG.md`, GitHub Releases 링크 유효성 확인
- 내용이 현재 프로젝트 상태와 맞으면 유지

### `.cursor/rules/specify-rules.mdc`

- `alwaysApply`, `description` 메타 필드가 현재 플랜·훅 구조와 일치하는지 확인
- 불일치 시 재생성 필요 여부를 PR 본문에 기록; 수동 편집 불가

## PR 체크리스트

- [ ] `npm run docs:audit-links` 통과
- [ ] 수정 파일: 위 5개 외 변경 없음
- [ ] 스냅샷 문서 미수정 확인
