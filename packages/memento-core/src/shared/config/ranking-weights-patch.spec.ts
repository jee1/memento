import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRankingKnobChanges } from './ranking-weights-patch.js';
import { loadRankingWeights } from './ranking-weights-loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_TOML = resolve(here, '../../../../../config/ranking-weights.toml');
const toml = readFileSync(REPO_TOML, 'utf8');
const cleanup: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ranking-patch-'));
  cleanup.push(dir);
  return dir;
}

function commentLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trimStart().startsWith('#'));
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('applyRankingKnobChanges', () => {
  it('값 토큰만 바꾸고 주석 줄은 한 줄도 건드리지 않는다', () => {
    const { text } = applyRankingKnobChanges(toml, { 'relevance_signal.scale': 2.2, 'recency_signal.scale': 0.25 });
    expect(commentLines(text)).toEqual(commentLines(toml));
    expect(text).toContain('scale = 2.2\n');
    expect(text).toContain('scale = 0.25\n');
    expect(text.split('\n')).toHaveLength(toml.split('\n').length);
  });

  it('기존 소수 자릿수를 깨지 않는다', () => {
    const source = '[relevance_signal]\nscale = 2.0\n\n[recency_signal]\nscale = 0.30 # 뒤 주석\n\n[fts_relevance]\ntemperature = 10\n';
    const { text } = applyRankingKnobChanges(source, {
      'relevance_signal.scale': 2.25,
      'recency_signal.scale': 0.3,
      'fts_relevance.temperature': 12,
    });
    expect(text).toBe('[relevance_signal]\nscale = 2.25\n\n[recency_signal]\nscale = 0.30 # 뒤 주석\n\n[fts_relevance]\ntemperature = 12\n');
  });

  it('키 줄이 없으면 섹션 끝에 추가하고 다음 섹션의 앞 주석을 가져오지 않는다', () => {
    const source = '[ranking_weights]\nalpha = 0.45\n\n# 다음 섹션 설명\n[recency_signal]\nscale = 0.30\n';
    const { text } = applyRankingKnobChanges(source, { 'ranking_weights.theta': 0.12 });
    expect(text).toBe('[ranking_weights]\nalpha = 0.45\ntheta = 0.12\n\n# 다음 섹션 설명\n[recency_signal]\nscale = 0.30\n');
  });

  it('섹션이 없으면 파일 끝에 섹션째로 추가한다', () => {
    const { text } = applyRankingKnobChanges('[ranking_weights]\nalpha = 0.45\n', { 'relevance_signal.scale': 1.5 });
    expect(text).toBe('[ranking_weights]\nalpha = 0.45\n\n[relevance_signal]\nscale = 1.5\n');
  });

  it('loadRankingWeights 로 읽으면 제안 값이다', () => {
    const dir = tmp();
    const { text } = applyRankingKnobChanges(toml, {
      'relevance_signal.scale': 2.2,
      'ranking_weights.alpha': 0.5,
      'vector_length_decay.saturation_length': 90,
    });
    const file = join(dir, 'proposed.toml');
    writeFileSync(file, text);
    const config = loadRankingWeights(file);
    expect(config.relevance_signal.scale).toBe(2.2);
    expect(config.ranking_weights.alpha).toBe(0.5);
    expect(config.vector_length_decay.saturation_length).toBe(90);
    expect(config.recency_signal.scale).toBe(loadRankingWeights(REPO_TOML).recency_signal.scale);
  });

  it('변경이 없으면 diff 가 비고 텍스트가 같다', () => {
    const { text, diff } = applyRankingKnobChanges(toml, {});
    expect(diff).toBe('');
    expect(text).toBe(toml);
  });

  it('diff 가 git apply --check 를 통과하고 적용하면 text 와 바이트가 같다', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config/ranking-weights.toml'), toml);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const { text, diff } = applyRankingKnobChanges(toml, {
      'relevance_signal.scale': 2.2,
      'ranking_weights.theta': 0.12,
      'vector_length_decay.saturation_length': 90,
      'ranking_weights.zeta_fb': 0.06,
    });
    expect(diff.startsWith('--- a/config/ranking-weights.toml\n+++ b/config/ranking-weights.toml\n@@')).toBe(true);
    writeFileSync(join(dir, 'p.patch'), diff);
    execFileSync('git', ['apply', '--check', 'p.patch'], { cwd: dir });
    execFileSync('git', ['apply', 'p.patch'], { cwd: dir });
    expect(readFileSync(join(dir, 'config/ranking-weights.toml'), 'utf8')).toBe(text);
  });

  it('섹션 끝 추가와 새 섹션 추가도 git apply 가 받는다', () => {
    const dir = tmp();
    const source = '[ranking_weights]\nalpha = 0.45\n\n# 설명\n[recency_signal]\nscale = 0.30\n';
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config/ranking-weights.toml'), source);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const { text, diff } = applyRankingKnobChanges(source, {
      'ranking_weights.theta': 0.12,
      'relevance_signal.scale': 1.5,
    });
    writeFileSync(join(dir, 'p.patch'), diff);
    execFileSync('git', ['apply', '--check', 'p.patch'], { cwd: dir });
    execFileSync('git', ['apply', 'p.patch'], { cwd: dir });
    expect(readFileSync(join(dir, 'config/ranking-weights.toml'), 'utf8')).toBe(text);
  });

  it('알 수 없는 knob 과 유한하지 않은 값은 거절한다', () => {
    expect(() => applyRankingKnobChanges(toml, { 'nope.x': 1 } as never)).toThrow(/알 수 없는 knob/);
    expect(() => applyRankingKnobChanges(toml, { 'relevance_signal.scale': Number.NaN })).toThrow(/유한/);
  });
});
