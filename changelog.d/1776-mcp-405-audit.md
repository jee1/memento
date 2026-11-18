Fixed
- `/mcp` 의 `GET`/`DELETE` 에 규약대로 돌려주는 `405 Allow: POST` 를 `audit_log` 해시 체인에 failure 행으로 쓰지 않는다. `/mcp` 요청 24,361건(2026-10-19 이후) 중 비정상 1,448건(5.9%)의 94.7%(1,371건)가 이 405 였고, 제외하면 77건(0.3%)이다. `http-audit.jsonl` 에는 그대로 남는다. `recall` 에서 `type` 도 `memory_types` 도 없을 때의 오류 문구가 `memory_types` 대안을 알려 준다. 누락을 기본값으로 채우는 변경은 하지 않았다 (#1776)
