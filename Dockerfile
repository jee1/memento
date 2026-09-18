# Multi-stage build for Memento MCP Server
FROM node:24-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig*.json ./

# Copy workspace package.json files (npm workspaces 의존성 설치에 필요)
COPY packages/memento-core/package*.json ./packages/memento-core/
COPY packages/memento-server/package*.json ./packages/memento-server/
COPY packages/memento-agent-integration/package*.json ./packages/memento-agent-integration/
COPY packages/memento-client/package*.json ./packages/memento-client/
COPY apps/experimental-example/package*.json ./apps/experimental-example/

# Install all dependencies (including dev dependencies for build) without running scripts
RUN npm ci --ignore-scripts

# Copy source (모노레포: 루트 src/ 없음 — packages·apps·scripts)
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/ ./apps/

# Workspace 패키지 빌드 (@memento/core, memento-server, client, sync:root-server-dist)
RUN npm run build:packages

# Production stage
FROM node:24-slim AS production

# Install SQLite and development tools (FTS5 is included in SQLite)
# Install dependencies for sqlite-vec compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    git \
    cmake \
    build-essential \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and scripts
COPY package*.json ./
COPY scripts/ ./scripts/
COPY tests/fixtures/relation_testset.json ./tests/fixtures/relation_testset.json

# 빌드 산출물: 워크스페이스 패키지 (런타임은 memento-server 진입점 사용)
COPY --from=builder /app/packages/memento-core/dist ./packages/memento-core/dist
COPY --from=builder /app/packages/memento-core/prompts ./packages/memento-core/prompts
COPY --from=builder /app/packages/memento-core/package.json ./packages/memento-core/package.json
COPY --from=builder /app/packages/memento-server/dist ./packages/memento-server/dist
COPY --from=builder /app/packages/memento-server/package.json ./packages/memento-server/package.json
COPY --from=builder /app/packages/memento-agent-integration/dist ./packages/memento-agent-integration/dist
COPY --from=builder /app/packages/memento-agent-integration/package.json ./packages/memento-agent-integration/package.json
COPY --from=builder /app/package*.json ./

# Install production dependencies and rebuild native modules for Debian/Linux
# better-sqlite3: try prebuilt binaries first (much faster), fallback to source compile
# MiniLM warmup pulls the multilingual model (#889): q8 onnx is ~118MB vs ~23MB for the old
# English-only all-MiniLM-L6-v2, so the image grows by roughly 95MB.
# MiniLM 캐시는 transformers.js 의 기본 경로인 node_modules/@huggingface/transformers/.cache/ 에 쌓인다 (#1012).
# v4.2.0 은 캐시 위치 환경변수를 읽지 않는다 — src/env.js:162 의
# `DEFAULT_CACHE_DIR = path.join(dirname__, '/.cache/')`(dirname__ = 패키지 루트)가 전부이고,
# 옮기려면 pipeline() 호출 전에 코드에서 env.cacheDir 을 지정해야 한다.
# 빌드 warmup 과 런타임이 같은 기본값을 쓰기 때문에 캐시가 재사용된다. 캐시를 볼륨으로 빼려면
# 그 node_modules 하위 경로를 마운트해야 한다. 런타임 재사용 여부는 scripts/docker-smoke.mjs 가
# env.allowRemoteModels = false 로 검증한다.
# sqlite-vec: prebuilt vec0.so ships in the sqlite-vec-linux-x64 optional package (no build step), copy .so to /usr/lib/
ARG SKIP_TRANSFORMERS_WARMUP=0
RUN npm ci --omit=dev --ignore-scripts && \
    (npm rebuild better-sqlite3 2>/dev/null || npm rebuild better-sqlite3 --build-from-source) && \
    find /app/node_modules -name "*.so" -type f && \
    cp /app/node_modules/sqlite-vec-linux-x64/vec0.so /usr/lib/vec0 && \
    chmod +x /usr/lib/vec0 && \
    ls -la /usr/lib/vec0 && \
    # 이 이미지(linux/glibc/x64)에서 절대 로드될 수 없는 플랫폼 바이너리를 제거한다 (#995 240MB, #1016 141MB).
    # npm 이 lockfile 에 libc 필드를 기록하지 않아 musl 변종이 걸러지지 않는다 — npm 쪽 문제라 여기서 지운다.
    # sharp: dist/sharp.cjs 의 switch(runtimePlatform) 가 linux-x64 case 만 타므로 linuxmusl-* 는 도달 불가.
    # onnxruntime-node: dist/binding.js 가 bin/napi-v6/${process.platform}/${process.arch} 를 require 하므로
    # darwin/win32 디렉터리는 도달 불가.
    # onnxruntime-web: node 진입점은 exports.node 가 가리키는 dist/transformers.node.mjs 이고, 이 번들은
    # requireFromHere("onnxruntime-node") 만 부른다. webgpu 런타임은 번들에 인라인돼 있어 'onnxruntime-web'
    # 모듈 지정자는 src/ 와 dist/transformers.web.js 에만 남는데 둘 다 exports 맵에 서브패스가 없어 도달 불가.
    # onnxruntime-common 은 실제로 import 되므로 남긴다.
    rm -rf /app/node_modules/@img/sharp-linuxmusl-x64 \
           /app/node_modules/@img/sharp-libvips-linuxmusl-x64 \
           /app/node_modules/onnxruntime-node/bin/napi-v6/darwin \
           /app/node_modules/onnxruntime-node/bin/napi-v6/win32 \
           /app/node_modules/onnxruntime-web && \
    npm cache clean --force && \
    if [ "$SKIP_TRANSFORMERS_WARMUP" = "1" ]; then \
      echo '[docker] SKIP_TRANSFORMERS_WARMUP=1: MiniLM cache warmup skipped'; \
    else \
      node --input-type=module -e "\
        try { \
          const { pipeline } = await import('@huggingface/transformers'); \
          const embed = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { dtype: 'q8' }); \
          await embed('cache warmup'); \
          console.log('[docker] MiniLM cache warmup ok'); \
        } catch (e) { \
          const msg = e instanceof Error ? e.message : String(e); \
          console.warn('[docker] MiniLM cache warmup skipped (will fetch at runtime if needed):', msg); \
        } \
      "; \
    fi

# Create data directory
RUN mkdir -p /app/data /app/.memento

# Create non-root user
RUN groupadd -g 1001 nodejs
RUN useradd -r -u 1001 -g nodejs memento

# Change ownership (data directory will be mounted, so we'll set permissions at runtime)
RUN chown -R memento:nodejs /app
USER memento

# 이미지를 compose 없이 그대로 띄웠을 때의 기본값 (#1012).
# 아래 EXPOSE·HEALTHCHECK 와 CMD(start-container.sh)가 이미 HTTP·9001 을 약속하고 있는데,
# 코드 기본값은 넷 다 다른 값이라 `docker run <image>` 가 성립하지 않았다:
#   PORT                   코드 기본 3000 (environment.ts:17 MCP_SERVER_PORT) ≠ EXPOSE/HEALTHCHECK 9001
#   DB_PATH                코드 기본 ~/.memento/memory.db — memento 사용자는 홈 디렉터리가 없어 기동 실패
#   TRANSPORT_TYPE         코드 기본 stdio — start-container.sh 는 HTTP 서버를 띄운다
#   MEMENTO_HTTP_BIND_HOST 코드 기본 127.0.0.1 — -p 로 내도 컨테이너 밖에서 도달 불가
# compose 는 이 값들을 그대로 override 한다. 0.0.0.0 바인딩은 API 토큰이 없으면 기동이 거부되므로
# (shared/http/http-bind-policy.ts) 무인증 노출로 이어지지 않는다.
ENV PORT=9001
ENV DB_PATH=/app/data/memory.db
ENV TRANSPORT_TYPE=sse
ENV MEMENTO_HTTP_BIND_HOST=0.0.0.0

# Expose port
EXPOSE 9001

# Health check
# start-period 는 docker-compose.yml 의 40s 와 맞춘다 — 5s 는 느린 호스트에서 첫 검사가 항상 실패했다.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:9001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => { process.exit(1); });" || exit 1

# Copy startup script
COPY --chmod=755 scripts/start-container.sh /app/start-container.sh

# Copy static files (dashboard, graph UI)
COPY static/ /app/static/

# Start application
CMD ["/app/start-container.sh"]
