import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = join(process.cwd(), '.github/workflows');

function readWorkflows(): Array<{ name: string; source: string }> {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- 워크플로 디렉터리 내부 고정 경로
    .map((name) => ({ name, source: readFileSync(join(WORKFLOW_DIR, name), 'utf-8') }));
}

describe('#890 workflows skip the onnxruntime CUDA download', () => {
  it('every workflow that runs npm ci sets ONNXRUNTIME_NODE_INSTALL', () => {
    // onnxruntime-node의 postinstall이 nuget.org에서 CUDA/TensorRT provider를 받는다.
    // 러너에 GPU가 없어 쓰이지 않는데, ETIMEDOUT으로 npm ci가 통째로 실패한다.
    const missing = readWorkflows()
      .filter((workflow) => workflow.source.includes('npm ci'))
      .filter((workflow) => !workflow.source.includes('ONNXRUNTIME_NODE_INSTALL: skip'))
      .map((workflow) => workflow.name);

    expect(missing).toEqual([]);
  });

  it('covers the workflows that exist today', () => {
    // 위 검사가 "npm ci 를 쓰는 워크플로가 하나도 없다"로 공허하게 통과하지 않도록 고정한다
    const withNpmCi = readWorkflows()
      .filter((workflow) => workflow.source.includes('npm ci'))
      .map((workflow) => workflow.name)
      .sort();

    expect(withNpmCi).toContain('ci.yml');
    expect(withNpmCi.length).toBeGreaterThanOrEqual(5);
  });
});
