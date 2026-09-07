/**
 * #925 — validate npm audit --json report shape (fail-closed).
 * Pure helpers for check-production-audit-fixable.mjs.
 */

/**
 * @param {unknown} report
 * @returns {asserts report is {
 *   auditReportVersion: unknown,
 *   metadata: { vulnerabilities: unknown },
 *   vulnerabilities: Record<string, unknown>,
 * }}
 */
export function assertValidProductionAuditReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Invalid audit report: expected a plain object');
  }

  /** @type {Record<string, unknown>} */
  const r = /** @type {Record<string, unknown>} */ (report);

  if (r.error != null && typeof r.error === 'object') {
    const err = /** @type {Record<string, unknown>} */ (r.error);
    const code = typeof err.code === 'string' ? err.code : '';
    const summary = typeof err.summary === 'string' ? err.summary : '';
    const detail = [code, summary].filter(Boolean).join(': ') || 'unknown audit error';
    throw new Error(`Invalid audit report: error — ${detail}`);
  }

  if (!('auditReportVersion' in r) || r.auditReportVersion == null) {
    throw new Error('Invalid audit report: missing auditReportVersion');
  }

  const metadata = r.metadata;
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    !('vulnerabilities' in /** @type {Record<string, unknown>} */ (metadata)) ||
    /** @type {Record<string, unknown>} */ (metadata).vulnerabilities == null
  ) {
    throw new Error('Invalid audit report: missing metadata.vulnerabilities');
  }

  const vulns = r.vulnerabilities;
  if (vulns === null || typeof vulns !== 'object' || Array.isArray(vulns)) {
    throw new Error('Invalid audit report: missing vulnerabilities object');
  }
}
