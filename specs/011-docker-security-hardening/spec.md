# Feature Specification: Security Hardening for Docker and HTTP Admin

**Feature Branch**: `011-docker-security-hardening`
**Created**: 2026-04-05
**Status**: Clarified
**Input**: User description: "Security hardening: fix Docker root user, enforce admin auth, add HTTP security headers"

## Background

A security audit identified critical and high-severity vulnerabilities in the Memento MCP server deployment configuration and HTTP admin interface. These issues expose the system to unauthorized administrative access and privilege escalation risks. This specification covers four targeted fixes:

1. Remove hardcoded insecure HTTP admin bypass flag from container configuration
2. Enforce non-root user execution in Docker containers
3. Require mandatory authentication for all admin API endpoints when no key is configured
4. Add standard HTTP security headers to all server responses

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Auth Cannot Be Bypassed via Container Config (Priority: P1)

As an operator deploying Memento in a production environment, I need confidence that the admin API cannot be accessed without credentials — even if the container configuration file is checked into version control or shared with others.

Currently, the base Docker Compose configuration contains a hardcoded flag that permanently disables admin authentication. This means anyone with network access to the admin port can call any admin endpoint regardless of whether an API key is configured.

**Why this priority**: This is a critical-severity issue. Hardcoded auth bypass in a shared configuration file nullifies all other authentication controls. Any deployment using the base config is fully exposed.

**Independent Test**: Can be verified by deploying the container without the bypass flag and confirming that admin endpoints return 401 Unauthorized when no API key is provided.

**Acceptance Scenarios**:

1. **Given** the base Docker Compose configuration is used, **When** a request is made to any admin endpoint without an API key, **Then** the server returns 401 Unauthorized
2. **Given** no environment variable overrides are set, **When** the container starts, **Then** admin authentication is active by default
3. **Given** the configuration files are inspected, **When** searching for the insecure bypass flag, **Then** it is not present in any configuration file committed to the repository

---

### User Story 2 - Admin API Requires Authentication When No Key Is Configured (Priority: P1)

As a security-conscious operator, I need the admin API to refuse all requests if no API key has been configured — rather than silently allowing access. An unconfigured API key should be treated as a configuration error, not as permission to skip authentication entirely.

**Why this priority**: This is a high-severity issue. A missing API key silently granting full admin access is a dangerous fail-open design. Systems should fail closed (deny access) when security configuration is absent.

**Independent Test**: Can be verified by starting the server without setting an admin API key and confirming that all admin endpoints return 401 or 503 rather than 200.

**Acceptance Scenarios**:

1. **Given** no admin API key is configured (absent or empty), **When** any admin endpoint is called, **Then** the server refuses the request with an error response (401 or 503)
2. **Given** no admin API key is configured, **When** the server starts, **Then** a warning is logged indicating that admin API is disabled or misconfigured
3. **Given** a valid non-empty admin API key is configured, **When** a request is made with the correct key, **Then** the admin endpoint responds normally

---

### User Story 3 - Docker Container Runs as Non-Root User (Priority: P2)

As an operator, I need Docker containers to run as the dedicated application user rather than root. If a container is compromised, a non-root process has significantly fewer privileges to damage the host system or escalate further.

Currently, the Docker Compose configuration explicitly overrides the container's built-in non-root user with root, negating the security work already done in the container image definition.

**Why this priority**: This is a high-severity issue. Running as root inside a container dramatically expands the blast radius of any exploit. The container image already defines a non-root user, making this a simple configuration correction.

**Independent Test**: Can be verified by inspecting the running container's process owner and confirming it is not root (UID not equal to 0).

**Acceptance Scenarios**:

1. **Given** the Docker Compose configuration, **When** the container starts, **Then** the application process runs as a non-root user
2. **Given** the container image defines the application user with a specific non-root UID, **When** the container is launched via Docker Compose, **Then** the running process owner matches that non-root user
3. **Given** a compromised container scenario, **When** an attacker attempts root-level operations on the host, **Then** they are denied due to insufficient privileges

---

### User Story 4 - HTTP Responses Include Standard Security Headers (Priority: P3)

As an operator or security auditor, I need all HTTP responses from the Memento server to include standard security headers. These headers instruct browsers and security tools to enforce safe behaviors: preventing the admin UI from being embedded in iframes on malicious sites, blocking cross-site scripting attacks, and enforcing HTTPS where applicable.

**Why this priority**: This is a medium-severity issue. Missing security headers create known attack vectors such as clickjacking and MIME-type confusion. Adding them is low-risk and broadly recommended by security standards such as OWASP.

**Independent Test**: Can be verified by making any HTTP request to the server and inspecting the response headers for the presence of standard security headers.

**Acceptance Scenarios**:

1. **Given** the HTTP server is running, **When** any HTTP response is returned, **Then** it includes a header that prevents the page from being embedded in iframes on other domains
2. **Given** the HTTP server is running, **When** any HTTP response is returned, **Then** it includes a Content Security Policy header restricting resource loading
3. **Given** the HTTP server is running, **When** any HTTP response is returned, **Then** it includes a header that prevents MIME-type sniffing
4. **Given** the HTTP server is running, **When** any HTTP response is returned, **Then** it includes a referrer policy header

---

### Edge Cases

- What happens when the admin API key is set to a value consisting only of whitespace? (Should be treated as unconfigured/empty — access denied)
- What happens if an existing deployment relied on the bypass flag? (Operators must configure a valid API key to regain admin access — this is an intentional breaking change)
- What happens if a security header conflicts with an existing response header already set by a route handler? (Security headers take precedence; no silent omission)
- What happens if the container volume mounts require root-level file permissions? (Operators must ensure volume permissions are compatible with the non-root user — this is a deployment concern, not a code issue)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The base Docker Compose configuration MUST NOT contain any flag or environment variable that disables or bypasses admin API authentication
- **FR-002**: When the admin API key is absent, empty, or contains only whitespace, the system MUST deny all admin API requests rather than granting unauthenticated access
- **FR-003**: When the admin API key is absent or empty at startup, the system MUST log a warning indicating that admin API access is disabled or requires configuration
- **FR-004**: Docker containers MUST run as the application's dedicated non-root user as defined in the container image; the Docker Compose configuration MUST NOT override this to root
- **FR-005**: All HTTP responses from the server MUST include security headers covering: frame embedding restrictions, content type options, content security policy, and referrer policy
- **FR-006**: HTTP security headers MUST be applied uniformly to all response paths including admin API endpoints, MCP HTTP transport endpoints, and any served static assets
- **FR-007**: The removal of the insecure bypass flag MUST NOT break legitimate admin access for operators who have a valid API key configured

### Key Entities

- **Admin API Key**: A secret credential that grants access to administrative endpoints; must be non-empty and non-whitespace to enable admin API access
- **Container User**: The operating system user under which the application process runs inside the Docker container; must be the dedicated application user, not root
- **HTTP Security Headers**: A set of standard response headers that instruct browsers and proxies to enforce protective behaviors against common web attacks

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero admin API endpoints are accessible without a valid API key in any deployment using the standard configuration files
- **SC-002**: All running containers launched via the standard Docker Compose files show a non-root process owner for the application process
- **SC-003**: 100% of HTTP responses include all required security headers, verifiable by automated header inspection against a defined checklist
- **SC-004**: A scan of all repository configuration files committed to version control finds zero hardcoded authentication bypass flags
- **SC-005**: Operators with a valid admin API key configured experience no disruption to admin API access after these fixes are applied

## Assumptions

- The container image already defines a dedicated non-root application user; this fix only removes the Docker Compose override that reverts it to root
- No legitimate use case requires the admin API to be accessible without credentials in a standard deployment
- HTTP security header values will follow OWASP-recommended defaults; fine-tuning of specific header values (e.g., Content Security Policy directives) is out of scope for this initial fix
- API key rotation and secret management practices are handled separately by operators and are out of scope
- These fixes apply to all standard deployment configurations in the repository; custom or downstream deployments are out of scope

## Out of Scope

- API key rotation tooling or automated secret management
- Role-based access control or fine-grained admin permissions
- TLS/HTTPS termination configuration
- Rate limiting or brute-force protection for the admin API
- Authentication for MCP stdio transport (separate transport with a different trust model)
- Remediation of any security issues beyond the four identified in this audit

---

## Clarifications

### Session 2026-04-05

- **Q**: Should `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` be removed from `docker-compose.base.yml` only, or should the environment variable and all supporting code be removed from the codebase entirely? → **A**: Remove the hardcoded `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` line from `docker-compose.base.yml` (FR-001). The environment variable and its supporting code (`allowInsecureHttpAdmin` in config, `getMementoHttpSecurityStartupViolationMessage`) **must be retained** in the codebase — it exists as an explicit developer escape hatch for local non-loopback development and is already gated behind startup warnings. Removing it from compose prevents accidental production exposure; removing it from code would break the intentional dev workflow. The variable remains available but must be explicitly opted in, never hardcoded in shared config files.

- **Q**: When `ADMIN_API_KEY` is not set, should the server hard-fail at startup, or apply a fail-secure per-request denial while still starting? → **A**: Apply **fail-secure per-request denial** (return 401 for all admin endpoints) rather than preventing startup. Rationale: (1) The existing `getMementoHttpSecurityStartupViolationMessage` already blocks startup when binding to a non-loopback host without a key — this covers the most dangerous case. (2) For loopback-only deployments (the safe default), refusing startup would break development workflows where the operator hasn't yet configured a key. (3) FR-002 + FR-003 together achieve the fail-secure goal: every request is denied and a startup warning is logged. The middleware in `admin-auth.middleware.ts` must be updated to treat a missing/empty/whitespace key as "deny all" instead of "allow all" (the current fail-open behavior on line 15 must be inverted).

- **Q**: Should HTTP security headers apply to **all routes** (including MCP HTTP transport `/mcp`, `/sse`) or only to admin/API routes? → **A**: Apply to **all HTTP responses** from the server. Reasoning: (1) FR-006 explicitly states "all response paths including admin API endpoints, MCP HTTP transport endpoints, and any served static assets." (2) Security headers like `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` are harmless to API and transport clients but provide defense-in-depth for any browser that might load these endpoints. (3) A global Express middleware (e.g., `helmet()` or a custom equivalent) registered before all routes is the correct implementation pattern — not per-route injection.

- **Q**: Which HTTP security headers are required, and is adherence to a specific compliance standard (OWASP, CIS, Helmet.js defaults) expected? → **A**: Target **OWASP-recommended minimum set** using **Helmet.js defaults** as the implementation baseline. Required headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'self'`, `Referrer-Policy: no-referrer`. Helmet.js v7+ defaults cover all four and add `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies` at no extra cost. The Assumptions section already states "HTTP security header values will follow OWASP-recommended defaults" — this answer operationalizes that assumption as "use Helmet.js defaults with no custom overrides in scope." Fine-tuning CSP directives (e.g., allowing specific CDN origins for the admin dashboard) remains out of scope per existing Assumptions.

- **Q**: For operators who currently rely on `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` in their local `docker-compose.override.yml` or `.env`, is an explicit migration note required in the spec? → **A**: **Yes — a migration note is required** and must be captured in the spec and surfaced in implementation documentation. The variable is not being removed, so existing local overrides continue to work. However, the spec must clearly state: (1) operators using the base compose file will experience a **breaking change** (admin endpoints now return 401 without a key), (2) the escape hatch `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true` remains available for local dev but must be set explicitly in a non-committed override file, and (3) production deployments must set `ADMIN_API_KEY` to a non-empty secret. This ensures FR-007 (no disruption for operators with a valid key) is met while being transparent about the intentional behavior change.

### Impact on Requirements

The above clarifications refine the following requirements:

- **FR-002 (updated)**: When `ADMIN_API_KEY` is absent, empty, or contains only whitespace, the admin auth middleware MUST return 401 for all admin requests. This is a behavior inversion of the current middleware (which currently passes through when no key is set). The startup violation check for non-loopback bindings remains unchanged.
- **FR-003 (updated)**: The warning MUST be emitted at startup regardless of bind host (not only for non-loopback). The current implementation only blocks startup for non-loopback; a non-fatal warning for loopback-only deployments must also be added.
- **FR-005 (clarified)**: The minimum required header set is: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'self'`, `Referrer-Policy: no-referrer`. Implementation via Helmet.js v7+ defaults is acceptable and preferred.
- **FR-006 (clarified)**: Headers must be applied via a single global middleware registered before all route handlers in Express — not selectively per route.
- **New FR-008**: The `CHANGELOG` or migration notes for this feature MUST document that removing `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` from the base compose is a breaking change for any deployment that relied on it, and must describe the migration path (set `ADMIN_API_KEY` or use an override file).
