import { describe, it, expect } from 'vitest';
import { buildFTSQuery } from './search-engine-fts-query.js';

describe('buildFTSQuery 조사 떼기 (#1821)', () => {
  it('붙은 조사 낱말은 원래 꼴과 뗀 꼴을 모두 OR 로 넣는다', () => {
    expect(buildFTSQuery('불필요한 객체를 만들 필요가 없다며 등록한 이슈 번호는')).toBe(
      '불필요한* OR 객체를* OR 객체* OR 만들* OR 필요가* OR 필요* OR 없다며* OR 등록한* OR 이슈* OR 번호는* OR 번호*',
    );
  });

  it('긴 조사부터 보되 어간이 1자가 되면 건너뛰고 다음 조사를 본다', () => {
    expect(buildFTSQuery('건으로')).toBe('건으로* OR 건으*');
  });

  it('어간이 1자뿐이면 원래 꼴만 쓴다', () => {
    expect(buildFTSQuery('책을')).toBe('책을*');
  });

  it('한글로 끝나지 않는 낱말은 하나만, 한글로 끝나는 영숫자 낱말은 뗀 꼴을 더한다', () => {
    expect(buildFTSQuery('memento 1729 머슴6은')).toBe('memento* OR 1729* OR 머슴6은* OR 머슴6*');
  });

  it('상한 8개 뒤 낱말은 버리고 결과는 최대 16개다', () => {
    const q = buildFTSQuery('객체를 서버를 데이터를 파일을 모듈을 함수를 변수를 클래스를 인자를');
    const terms = q.split(' OR ');
    expect(terms).toHaveLength(16);
    expect(q).not.toContain('인자');
  });

  it('같은 FTS 낱말은 처음 나온 자리에 한 번만 둔다', () => {
    expect(buildFTSQuery('객체를 객체를')).toBe('객체를* OR 객체*');
  });
});
