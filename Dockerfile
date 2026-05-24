# Multi-stage build for Memento MCP Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig*.json ./

# Copy workspace package.json files (npm workspaces 의존성 설치에 필요)
COPY packages/memento-core/package*.json ./packages/memento-core/
COPY packages/memento-server/package*.json ./packages/memento-server/
COPY packages/memento-client/package*.json ./packages/memento-client/
COPY packages/mcp-client/package*.json ./packages/mcp-client/
COPY apps/experimental-example/package*.json ./apps/experimental-example/

# Install all dependencies (including dev dependencies for build) without running scripts
RUN npm ci --ignore-scripts

# Copy source (모노레포: 루트 src/ 없음 — packages·apps·scripts)
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/ ./apps/

# Run postinstall scripts now that source code is available
RUN npm run postinstall

# Workspace 패키지 빌드 (@memento/core, memento-server, client, sync:root-server-dist)
RUN npm run build:packages

# Production stage
FROM node:20-slim AS production

# Use the same cache directory as the builder stage
ENV XDG_CACHE_HOME=/app/.cache
ENV TRANSFORMERS_CACHE=/app/.cache/transformers
RUN mkdir -p "$TRANSFORMERS_CACHE"

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

# Copy package files and scripts, then install dependencies
COPY package*.json ./
COPY scripts/ ./scripts/
COPY tests/fixtures/relation_testset.json ./tests/fixtures/relation_testset.json
# 소스·워크스페이스 미복사 상태 — postinstall(auto-setup)은 패키지 경로가 없어 실패하므로 스크립트 생략
RUN npm cache clean --force && npm install --omit=dev --ignore-scripts

# Install sqlite-vec npm package and copy .so files to /usr/lib/ without .so extension
RUN npm install sqlite-vec --build-from-source && \
    find /app/node_modules -name "*.so" -type f && \
    cp /app/node_modules/sqlite-vec-linux-x64/vec0.so /usr/lib/vec0 && \
    chmod +x /usr/lib/vec0 && \
    ls -la /usr/lib/vec0

# 빌드 산출물: 워크스페이스 패키지 (런타임은 memento-server 진입점 사용)
COPY --from=builder /app/packages/memento-core/dist ./packages/memento-core/dist
COPY --from=builder /app/packages/memento-core/prompts ./packages/memento-core/prompts
COPY --from=builder /app/packages/memento-core/package.json ./packages/memento-core/package.json
COPY --from=builder /app/packages/memento-server/dist ./packages/memento-server/dist
COPY --from=builder /app/packages/memento-server/package.json ./packages/memento-server/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Install only production dependencies (skip scripts since they were already run in builder stage)
# Rebuild better-sqlite3 for Debian Linux and install sqlite-vec
# MiniLM HF 워밍업은 네트워크(Hugging Face) 의존 — 타임아웃·차단 시에도 빌드는 성공시키고 런타임에 캐시되도록 함.
# 완전히 생략하려면: docker build --build-arg SKIP_TRANSFORMERS_WARMUP=1 ...
ARG SKIP_TRANSFORMERS_WARMUP=0
RUN npm ci --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3 --build-from-source && \
    npm install sqlite-vec --build-from-source && \
    npm rebuild sharp && \
    npm cache clean --force && \
    if [ "$SKIP_TRANSFORMERS_WARMUP" = "1" ]; then \
      echo '[docker] SKIP_TRANSFORMERS_WARMUP=1: MiniLM cache warmup skipped'; \
    else \
      node --input-type=module -e "\
        try { \
          const { pipeline } = await import('@xenova/transformers'); \
          const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); \
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

# Expose port
EXPOSE 9001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:9001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => { process.exit(1); });" || exit 1

# Copy startup script
COPY --chmod=755 scripts/start-container.sh /app/start-container.sh

# Copy static files (dashboard, graph UI)
COPY static/ /app/static/

# Start application
CMD ["/app/start-container.sh"]
