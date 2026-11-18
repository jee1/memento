import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'check-production-audit-fixable.mjs');

const advisory = { source: 1, title: 'x', url: 'u', severity: 'high', range: '<=1' };

function vuln(name: string, via: unknown[], fixAvailable: unknown) {
  return { name, severity: 'high', isDirect: false, via, effects: [], range: '*', nodes: [], fixAvailable };
}

function runGate(vulnerabilities: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  const file = join(dir, 'audit.json');
  writeFileSync(
    file,
    JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { total: 0 } } }),
  );
  return spawnSync(process.execPath, [SCRIPT, '--include-dev', file], { encoding: 'utf8' });
}

const majorOnly = { name: 'vitest', version: '3.1.4', isSemVerMajor: true };

describe('check-production-audit-fixable --include-dev (#1764)', () => {
  const picomatch = vuln('picomatch', [advisory], majorOnly);

  it('원인이 모두 고칠 수 없으면 via 만 있는 노드는 fixAvailable=true 여도 수용한다', () => {
    const result = runGate({ picomatch, vite: vuln('vite', ['picomatch'], true) });
    expect(result.status).toBe(0);
  });

  it('두 단계 이상 거친 노드도 수용한다', () => {
    const result = runGate({
      picomatch,
      tinyglobby: vuln('tinyglobby', ['picomatch'], majorOnly),
      estree: vuln('estree', ['tinyglobby'], true),
    });
    expect(result.status).toBe(0);
  });

  it('via 가 서로를 가리키는 순환도 원인이 고칠 수 없으면 수용한다', () => {
    const result = runGate({
      picomatch,
      vitest: vuln('vitest', ['coverage', 'picomatch'], true),
      coverage: vuln('coverage', ['vitest'], true),
    });
    expect(result.status).toBe(0);
  });

  it('순환 안에 고칠 수 있는 원인이 있으면 막는다', () => {
    const result = runGate({
      picomatch,
      vitest: vuln('vitest', ['coverage', 'picomatch'], true),
      coverage: vuln('coverage', ['vitest', 'fixable'], true),
      fixable: vuln('fixable', [advisory], true),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vitest (high)');
  });

  it('원인에 고칠 수 있는 패키지가 있으면 via 만 있는 노드도 막는다', () => {
    const result = runGate({
      picomatch: vuln('picomatch', [advisory], true),
      vite: vuln('vite', ['picomatch'], true),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vite (high)');
  });

  it('원인이 보고서에 없으면 npm 의 판정을 따라 막는다', () => {
    const result = runGate({ picomatch, vite: vuln('vite', ['ghost'], true) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vite (high)');
  });

  it('자체 권고가 있고 고칠 수 있는 패키지는 막는다', () => {
    const result = runGate({ picomatch, other: vuln('other', [advisory], true) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('other (high)');
  });

  it('via 만 있던 패키지에 자체 권고가 생기면 허용 목록에 없어서 막는다', () => {
    const result = runGate({ picomatch, vite: vuln('vite', [advisory, 'picomatch'], majorOnly) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vite (high)');
    expect(result.stderr).toContain('accepted-audit.json');
  });
});
