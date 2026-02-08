/**
 * Process Attribute Fit 테스트 (Issue #91)
 *
 * Given/When/Then:
 * - Given: process attributes { topics: ['budget'], workflow_names: ['재정'], skill_names: [] }, memory item { tags: ['budget'], workflow_name: '재정', skill_name: null }
 * - When: computeProcessAttributeFit(attr, item)
 * - Then: score > 0
 * - Given: same attr, memory item { tags: [], workflow_name: null, skill_name: null }
 * - When: computeProcessAttributeFit(attr, item)
 * - Then: score === 0
 * - Given: attr === null
 * - When: computeProcessAttributeFit(null, item)
 * - Then: score === 1 (중립)
 */

import { describe, it, expect } from 'vitest';
import { computeProcessAttributeFit } from '../process-attribute-fit.js';
import type { ProcessAttribute } from '../../../../shared/types/index.js';

describe('computeProcessAttributeFit', () => {
  it('Given: process attr에 budget·재정, memory에 tags=["budget"], workflow_name=재정, When: computeProcessAttributeFit, Then: score > 0', () => {
    const attr: ProcessAttribute = {
      process_id: 'p1',
      topics: ['budget'],
      workflow_names: ['재정'],
      skill_names: []
    };
    const item = { tags: ['budget'], workflow_name: '재정', skill_name: null as string | null };
    const score = computeProcessAttributeFit(attr, item);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('Given: process attr에 budget·재정, memory에 tags=[], workflow_name=null, skill_name=null, When: computeProcessAttributeFit, Then: score === 0', () => {
    const attr: ProcessAttribute = {
      process_id: 'p1',
      topics: ['budget'],
      workflow_names: ['재정'],
      skill_names: []
    };
    const item = { tags: [], workflow_name: null as string | null, skill_name: null as string | null };
    const score = computeProcessAttributeFit(attr, item);
    expect(score).toBe(0);
  });

  it('Given: attr === null, When: computeProcessAttributeFit(null, item), Then: score === 1', () => {
    const item = { tags: ['x'], workflow_name: null as string | null, skill_name: null as string | null };
    const score = computeProcessAttributeFit(null, item);
    expect(score).toBe(1);
  });

  it('Given: process attr에 빈 배열들, When: computeProcessAttributeFit, Then: score === 1 (중립)', () => {
    const attr: ProcessAttribute = { process_id: 'p1', topics: [], workflow_names: [], skill_names: [] };
    const item = { tags: ['any'], workflow_name: null as string | null, skill_name: null as string | null };
    const score = computeProcessAttributeFit(attr, item);
    expect(score).toBe(1);
  });
});
