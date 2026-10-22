import { describe, expect, it } from 'vitest';
import { stripMemoryTemplateLabels } from '../../../consolidation/services/template-label-normalizer.js';
import {
  displayWorkRecordContent,
  renderWorkRecord,
  resolveStoredContent,
  workRecordSearchText,
  type WorkRecord,
} from '../work-record.js';

const record: WorkRecord = {
  decision: '컬럼을 추가한다',
  rationale: 'regex 가 대시를 놓친다',
  rejected: 'reflection_notes 재사용',
  failed: '',
  next_blocker: '운영 백필 승인',
};

describe('work record (#1446)', () => {
  it('keeps label strings out of the stored body', () => {
    const stored = resolveStoredContent(undefined, record);
    expect(stored).toBe(workRecordSearchText(record));
    expect(stored).not.toMatch(/결정:|근거:|버린 대안:|안 통한 것:|다음 걸림돌:/);
    expect(stored).not.toContain('없음');
  });

  it('matches a stripped label template without the strip regex', () => {
    const labeled = renderWorkRecord({ ...record, failed: '없음' });
    const stored = workRecordSearchText({ ...record, failed: '없음' });
    expect(stored).toBe(stripMemoryTemplateLabels(labeled).trim());
    expect(stored).toBe(resolveStoredContent(labeled, { ...record, failed: '없음' }));
  });

  it('appends extra prose and renders labels only for display', () => {
    const stored = resolveStoredContent('추가 메모', record);
    expect(stored.endsWith('추가 메모')).toBe(true);
    expect(stored).not.toContain('결정:');
    const shown = displayWorkRecordContent(stored, JSON.stringify(record));
    expect(shown.startsWith('결정: 컬럼을 추가한다')).toBe(true);
    expect(shown.endsWith('추가 메모')).toBe(true);
  });

  it('leaves content-only saves unchanged', () => {
    expect(resolveStoredContent('기존 본문', undefined)).toBe('기존 본문');
    expect(displayWorkRecordContent('기존 본문', null)).toBe('기존 본문');
  });
});
