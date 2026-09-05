import { describe, expect, it } from 'vitest';
import { PIIMasker } from '../pii-masker.js';

/**
 * #854 — Korean phone regex must not eat epoch-ms inside system ids.
 */
describe('PIIMasker phone digit boundaries (#854)', () => {
  it('preserves mem_<epoch13>_<suffix>', () => {
    const id = 'mem_1788581911067_d7yc4k698';
    const result = PIIMasker.mask(id);
    expect(result.masked).toBe(id);
    expect(result.masked).not.toContain('[PHONE]');
  });

  it('preserves search_<epoch13>_<suffix> (#861 live case)', () => {
    const id = 'search_1788598782002_s53nhvc67';
    const result = PIIMasker.mask(id);
    expect(result.masked).toBe(id);
    expect(result.masked).not.toContain('[PHONE]');
  });

  it('preserves failure_*_<epoch13>', () => {
    const id = 'failure_remember_tool_error_41c0d83a_1788581877628';
    const result = PIIMasker.mask(id);
    expect(result.masked).toBe(id);
    expect(result.masked).not.toContain('[PHONE]');
  });

  it('preserves port / non-phone digit runs from issue repro', () => {
    const text = '포트 18000 및 1234567890';
    const result = PIIMasker.mask(text);
    expect(result.masked).toBe(text);
    expect(result.masked).not.toContain('[PHONE]');
  });

  it('preserves epoch digits inside quarantine-style paths', () => {
    const path = '/var/lib/memento/quarantine/snap_1788581911067.db';
    const result = PIIMasker.mask(path);
    expect(result.masked).toBe(path);
  });

  it('still masks spaced Korean mobile', () => {
    const result = PIIMasker.mask('연락처: 010-1234-5678');
    expect(result.masked).toContain('[PHONE]');
    expect(result.masked).not.toContain('010-1234-5678');
  });

  it('still masks compact Korean mobile', () => {
    const result = PIIMasker.mask('call 01012345678 now');
    expect(result.masked).toContain('[PHONE]');
    expect(result.masked).not.toContain('01012345678');
  });

  it('still masks +82 Korean international form', () => {
    const result = PIIMasker.mask('+82-10-1234-5678');
    expect(result.masked).toContain('[PHONE]');
    expect(result.masked).not.toContain('10-1234-5678');
  });

  it('still masks international +1 style numbers', () => {
    const result = PIIMasker.mask('office +1-234-567-8900');
    expect(result.masked).toContain('[PHONE]');
    expect(result.masked).not.toContain('234-567-8900');
  });

  it('masks phone beside letters but not inside longer digit runs', () => {
    const mixed = 'user mem_1788581911067_x phone=010-9999-8888';
    const result = PIIMasker.mask(mixed);
    expect(result.masked).toContain('mem_1788581911067_x');
    expect(result.masked).toContain('[PHONE]');
    expect(result.masked).not.toContain('010-9999-8888');
  });
});
