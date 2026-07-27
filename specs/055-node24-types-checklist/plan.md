# Implementation Plan: @types/node@24 + checklist

1. package.json 5곳 `@types/node`를 `^24.0.0`으로 올리고 `npm install`로 lockfile 갱신.
2. `npm run type-check`로 회귀 확인; 깨지면 최소 수정.
3. KO troubleshooting에 "Node 24 전환 검증 체크리스트" 섹션 추가; EN에 동일 요점.
