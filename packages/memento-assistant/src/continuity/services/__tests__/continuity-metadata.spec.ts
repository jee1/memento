import { describe, expect, it } from 'vitest';
import {
  buildContinuityTags,
  buildOriginSource,
  parseOriginSource,
} from '../continuity-metadata.js';

describe('continuity-metadata', () => {
  it('task/decision/blocker/next-step 태그를 중복 없이 정규화한다', () => {
    expect(
      buildContinuityTags(['task', 'next-step', 'task'], ['continuity', 'resume'])
    ).toEqual(['continuity', 'resume', 'task', 'next-step']);
  });

  it('project/branch/session/file 정보를 origin_source JSON으로 직렬화한다', () => {
    const encoded = buildOriginSource({
      project: 'memento',
      branch: 'feature/resume',
      session_id: 'sess-1',
      files: ['src/server/index.ts'],
    });

    expect(parseOriginSource(encoded)).toMatchObject({
      project: 'memento',
      branch: 'feature/resume',
      session_id: 'sess-1',
    });
  });

  it('parseOriginSource accepts parsed object input', () => {
    expect(
      parseOriginSource({ project: 'memento', branch: 'feature/a' } as never)
    ).toMatchObject({
      project: 'memento',
      branch: 'feature/a',
    });
  });
});
