FROM node:24-alpine

RUN apk add --no-cache docker-cli

WORKDIR /workspace

COPY package*.json ./
COPY tsconfig*.json ./
COPY packages/memento-core/package*.json ./packages/memento-core/
COPY packages/memento-server/package*.json ./packages/memento-server/
COPY packages/memento-client/package*.json ./packages/memento-client/
COPY packages/mcp-client/package*.json ./packages/mcp-client/
COPY apps/experimental-example/package*.json ./apps/experimental-example/
COPY scripts ./scripts
COPY packages/memento-core/src/shared ./packages/memento-core/src/shared

RUN npm ci --ignore-scripts

CMD ["npx", "tsx", "scripts/log-issue-monitor/index.ts"]

