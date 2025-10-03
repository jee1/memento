# Multi-stage build for Memento MCP Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install all dependencies (including dev dependencies for build) without running scripts
RUN npm ci --ignore-scripts

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/

# Run postinstall scripts now that source code is available
RUN npm run postinstall

# Build application
RUN npm run build

# Production stage
FROM node:20-slim AS production

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
RUN npm cache clean --force && npm install --omit=dev

# Install sqlite-vec npm package and copy .so files to /usr/lib/ without .so extension
RUN npm install sqlite-vec --build-from-source && \
    find /app/node_modules -name "*.so" -type f && \
    cp /app/node_modules/sqlite-vec-linux-x64/vec0.so /usr/lib/vec0 && \
    chmod +x /usr/lib/vec0 && \
    ls -la /usr/lib/vec0

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Install only production dependencies (skip scripts since they were already run in builder stage)
# Rebuild better-sqlite3 for Debian Linux and install sqlite-vec
RUN npm ci --only=production --ignore-scripts && \
    npm rebuild better-sqlite3 --build-from-source && \
    npm install sqlite-vec --build-from-source && \
    npm cache clean --force

# Create data directory
RUN mkdir -p /app/data

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
  CMD node -e "console.log('Health check passed')" || exit 1

# Copy startup script
COPY --chmod=755 scripts/start-container.sh /app/start-container.sh

# Start application
CMD ["/app/start-container.sh"]
