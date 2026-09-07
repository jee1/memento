/**
 * #925 — production audit report schema validation (pure).
 */
import { describe, it, expect } from 'vitest';

function validEmptyReport() {
  return {
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    vulnerabilities: {},
  };
}

describe('assertValidProductionAuditReport (#925)', () => {
  it('rejects E503-style error JSON', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() =>
      assertValidProductionAuditReport({
        error: { code: 'E503', summary: 'audit service unavailable' },
      }),
    ).toThrow(/E503|audit service unavailable|error/i);
  });

  it('rejects missing auditReportVersion', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    const report = validEmptyReport();
    delete report.auditReportVersion;
    expect(() => assertValidProductionAuditReport(report)).toThrow(/auditReportVersion/i);
  });

  it('rejects missing metadata.vulnerabilities', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() =>
      assertValidProductionAuditReport({
        auditReportVersion: 2,
        metadata: {},
        vulnerabilities: {},
      }),
    ).toThrow(/metadata\.vulnerabilities/i);
  });

  it('rejects missing vulnerabilities map', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() =>
      assertValidProductionAuditReport({
        auditReportVersion: 2,
        metadata: { vulnerabilities: { total: 0 } },
      }),
    ).toThrow(/vulnerabilities/i);
  });

  it('rejects non-object vulnerabilities', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() =>
      assertValidProductionAuditReport({
        auditReportVersion: 2,
        metadata: { vulnerabilities: { total: 0 } },
        vulnerabilities: null,
      }),
    ).toThrow(/vulnerabilities/i);
    expect(() =>
      assertValidProductionAuditReport({
        auditReportVersion: 2,
        metadata: { vulnerabilities: { total: 0 } },
        vulnerabilities: [],
      }),
    ).toThrow(/vulnerabilities/i);
  });

  it('rejects error even when vulnerabilities present (fail-closed)', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() =>
      assertValidProductionAuditReport({
        error: { code: 'E500', summary: 'boom' },
        auditReportVersion: 2,
        metadata: { vulnerabilities: { total: 0 } },
        vulnerabilities: {},
      }),
    ).toThrow(/error|E500|boom/i);
  });

  it('accepts valid empty report', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() => assertValidProductionAuditReport(validEmptyReport())).not.toThrow();
  });

  it('accepts valid report with vulnerability entries', async () => {
    const { assertValidProductionAuditReport } = await import('./production-audit-report.js');
    expect(() =>
      assertValidProductionAuditReport({
        ...validEmptyReport(),
        vulnerabilities: {
          'adm-zip': {
            name: 'adm-zip',
            severity: 'high',
            fixAvailable: false,
          },
        },
      }),
    ).not.toThrow();
  });
});
