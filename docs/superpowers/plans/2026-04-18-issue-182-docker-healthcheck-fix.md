# Issue 182 - Docker Healthcheck Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Docker healthcheck failure by replacing `curl` with Node.js built-in `http` module.

**Architecture:** Modify Docker Compose configuration to use a Node.js snippet for health checking, avoiding the need for `curl` in the production image.

**Tech Stack:** Docker, Docker Compose, Node.js

---

### Task 1: Update Main Docker Compose Configuration

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Modify healthcheck command**

Change the `test` command under `memento-mcp-server` service.

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "const http = require('http'); const req = http.get('http://localhost:${MCP_SERVER_PORT:-9001}/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => { process.exit(1); });"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "fix(docker): replace curl with node for healthcheck in docker-compose.yml"
```

---

### Task 2: Sync Production Docker Compose Configuration

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Check and modify healthcheck command**

Ensure `docker-compose.prod.yml` uses the same Node.js based healthcheck if it overrides the base one.

- [ ] **Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "fix(docker): ensure node-based healthcheck in docker-compose.prod.yml"
```

---

### Task 3: Update Dockerfile Default Healthcheck

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Update HEALTHCHECK instruction**

Update the `HEALTHCHECK` in `Dockerfile` to be consistent with the Compose files.

```dockerfile
# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:9001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => { process.exit(1); });" || exit 1
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): update Dockerfile default healthcheck to use http.get"
```

---

### Task 4: Verification

**Files:**
- N/A

- [ ] **Step 1: Build the image**

Run: `docker compose build`
Expected: Build success.

- [ ] **Step 2: Start the container**

Run: `docker compose up -d`
Expected: Container starts.

- [ ] **Step 3: Verify Health Status**

Wait for ~10 seconds after start.
Run: `docker inspect --format='{{json .State.Health}}' memento-mcp-server`
Expected: Status is "healthy".

- [ ] **Step 4: Cleanup**

Run: `docker compose down`
