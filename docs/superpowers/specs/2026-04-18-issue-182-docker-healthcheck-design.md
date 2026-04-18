# Spec: Issue 182 - Docker Healthcheck Fix (Node.js based)

## 1. Problem Statement
The current Docker setup fails the healthcheck because `docker-compose.yml` uses `curl`, which is not installed in the `node:20-slim` based Docker image. This causes containers to be marked as `unhealthy`.

## 2. Proposed Solution
Instead of adding `curl` to the production image, we will use Node.js's built-in `http` module to perform the healthcheck. This keeps the image lightweight and uses the existing runtime.

## 3. Implementation Details
### 3.1. Modify `docker-compose.yml`
Update the `healthcheck.test` command:
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "const http = require('http'); const req = http.get('http://localhost:${MCP_SERVER_PORT:-9001}/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => { process.exit(1); });"]
```

### 3.2. Sync with Other Compose Files
Ensure `docker-compose.prod.yml` (if it has a separate healthcheck) and `Dockerfile` defaults are consistent.

## 4. Verification Plan
1. Build the image in the worktree: `docker compose build`
2. Start the container: `docker compose up -d`
3. Wait for `start_period` (40s) and check status: `docker ps` or `docker inspect`
4. Verify status is `healthy`.
