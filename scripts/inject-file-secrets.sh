# shellcheck shell=sh
# Docker secrets 규약 (#1115): <VAR>_FILE 이 가리키는 파일을 읽어 <VAR> 에 주입한다.
# docker/docker-compose.prod.secrets.example.yml 과 docs/reference/ko/security.md 가
# 이 규약을 약속해 왔지만 구현이 없어, 예시대로 배포하면 시크릿이 하나도 로드되지 않았다.
#
# 이 파일은 실행하지 말고 `.` 으로 source 할 것. 값은 절대 로그에 찍지 않는다.
# 진행·실패 메시지는 전부 stderr 로 보낸다 — source 한 쪽의 stdout 을 오염시키지 않기 위해서다.
# 경로가 지정됐는데 읽을 수 없으면 조용히 넘어가지 않고 실패한다 — 시크릿 없는 기동은
# /tools·/mcp·/messages 가 401 로 죽는 상태라 조용한 성공보다 즉시 실패가 낫다.

for __secret_var in OPENAI_API_KEY GEMINI_API_KEY MEMENTO_API_TOKENS; do
  __secret_path=$(eval "printf '%s' \"\${${__secret_var}_FILE:-}\"")
  if [ -n "$__secret_path" ]; then
    if [ -r "$__secret_path" ]; then
      export "$__secret_var=$(cat "$__secret_path")"
      echo "🔐 ${__secret_var} 를 ${__secret_var}_FILE 에서 읽었습니다." >&2
    else
      echo "❌ ${__secret_var}_FILE=${__secret_path} 를 읽을 수 없습니다." >&2
      exit 1
    fi
  fi
done

unset __secret_var __secret_path
