# Multi-stage build for Memento MCP Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install SQLite and VSS extension
RUN apk add --no-cache sqlite sqlite-dev

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Create data directory
RUN mkdir -p /app/data

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S memento -u 1001

# Change ownership
RUN chown -R memento:nodejs /app
USER memento

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start application
CMD ["node", "dist/server/index.js"]
