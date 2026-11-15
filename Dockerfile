# Multi-stage build for Memento MCP Server
FROM node:24.22.1-alpine AS builder

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
# copy-assets.js 가 저장소 루트의 config/ 를 dist/config/ 로 옮긴다. 안 넣으면 조용히 건너뛴다.
COPY config/ ./config/

# Workspace 패키지 빌드 (@memento/core, memento-server, client, sync:root-server-dist)
RUN npm run build:packages

# Production stage
FROM node:24.22.1-slim AS production

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

# 빌드 산출물: 워크스페이스 패키지 (런타임은 memento-server 진입점 사용)
COPY --from=builder /app/packages/memento-core/dist ./packages/memento-core/dist
COPY --from=builder /app/packages/memento-core/package.json ./packages/memento-core/package.json
COPY --from=builder /app/packages/memento-server/dist ./packages/memento-server/dist
COPY --from=builder /app/packages/memento-server/package.json ./packages/memento-server/package.json
COPY --from=builder /app/packages/memento-agent-integration/dist ./packages/memento-agent-integration/dist
COPY --from=builder /app/packages/memento-agent-integration/package.json ./packages/memento-agent-integration/package.json
COPY --from=builder /app/package*.json ./

# smoke 가 이미지 안 모델 파일을 대조할 해시. 모델 패키지(npm)에는 실리지 않는다 (#1729).
COPY models/memento-embedding-e5-small-ko-v2/sha256.json ./scripts/model-sha256.json

# Install production dependencies and rebuild native modules for Debian/Linux
# better-sqlite3: try prebuilt binaries first (much faster), fallback to source compile
# 로컬 임베딩 모델은 dependencies 의 @jee1/memento-embedding-e5-small-ko-v2(q8 onnx 약 118MB)로 함께 설치되고
# 런타임이 원격을 끈 채 그 폴더에서 읽는다(#1729). 내려받는 warmup 과 transformers.js 캐시는 없다.
# sqlite-vec: prebuilt vec0.so ships in the sqlite-vec-linux-x64 optional package (no build step), copy .so to /usr/lib/
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
    npm cache clean --force

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
#   MEMENTO_HTTP_BIND_HOST 코드 기본 127.0.0.1 — -p 로 내보내도 컨테이너 밖에서 도달 불가
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
COPY --chmod=755 scripts/inject-file-secrets.sh /app/inject-file-secrets.sh

# Copy static files (dashboard, graph UI)
COPY static/ /app/static/

# Start application
CMD ["/app/start-container.sh"]
