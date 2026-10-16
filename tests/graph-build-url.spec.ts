import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Check = { value: string; checked: boolean };

const TYPES = ['episodic', 'semantic', 'procedural', 'working'];
const RELATIONS = ['supports', 'related_to', 'extracted_from', 'contradicts'];

let typeChecks: Check[];
let relationChecks: Check[];
let buildUrl: () => string;
const previousDocument = (globalThis as Record<string, unknown>).document;

function checked(list: Check[]): Check[] {
  return list.filter((item) => item.checked);
}

beforeAll(() => {
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-shared.js'), 'utf-8'))();
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-fetch.js'), 'utf-8'))();
  const ns = (globalThis as Record<string, any>).__MEMENTO_GRAPH__;
  ns.dom = {
    impSlider: { value: '0' },
    fullGraphToggle: { checked: false },
  };
  buildUrl = ns.buildUrl;
  (globalThis as Record<string, unknown>).document = {
    querySelectorAll(selector: string) {
      if (selector === '.type-check input:checked') {
        return checked(typeChecks);
      }
      if (selector === '.relation-check input:checked') {
        return checked(relationChecks);
      }
      return [];
    },
  };
});

afterAll(() => {
  if (previousDocument === undefined) {
    delete (globalThis as Record<string, unknown>).document;
  } else {
    (globalThis as Record<string, unknown>).document = previousDocument;
  }
});

describe('buildUrl relation_types', () => {
  function resetChecks(): void {
    typeChecks = TYPES.map((value) => ({ value, checked: true }));
    relationChecks = RELATIONS.map((value) => ({ value, checked: true }));
  }

  it('omits relation_types when all four relation boxes are checked', () => {
    resetChecks();

    expect(buildUrl()).toBe('/admin/graph');
  });

  it('sets relation_types to the checked subset', () => {
    resetChecks();
    relationChecks[2].checked = false;
    relationChecks[3].checked = false;

    expect(buildUrl()).toBe('/admin/graph?relation_types=supports%2Crelated_to');
  });

  it('omits relation_types when none are checked', () => {
    resetChecks();
    for (const box of relationChecks) {
      box.checked = false;
    }

    expect(buildUrl()).toBe('/admin/graph');
  });

  it('keeps memory types and relation types as separate params', () => {
    resetChecks();
    typeChecks[0].checked = false;
    relationChecks[0].checked = false;

    expect(buildUrl()).toBe(
      '/admin/graph?types=semantic%2Cprocedural%2Cworking&relation_types=related_to%2Cextracted_from%2Ccontradicts',
    );
  });
});
