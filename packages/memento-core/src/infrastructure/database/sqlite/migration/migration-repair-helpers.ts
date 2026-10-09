/**
 * Migration-boundary repair helpers (#1237).
 *
 * Used only by migrations 048/049 and operator scripts — not runtime memory paths.
 */

import type Database from 'better-sqlite3';

export interface PredicateCanonicalizationResult {
  canonical: string;
  original: string;
  success: boolean;
  synonym?: string;
}

interface PredicateDictionary {
  [canonical: string]: string[];
}

const ASCII_PREDICATE_KEY = /^[a-z0-9'-]+$/;

function englishStemCandidates(key: string): string[] {
  if (!ASCII_PREDICATE_KEY.test(key)) {
    return [];
  }

  const candidates: string[] = [];
  if (key.endsWith('ies') && key.length > 4) {
    candidates.push(`${key.slice(0, -3)}y`);
  }
  if (key.endsWith('es') && key.length > 3) {
    candidates.push(key.slice(0, -2));
  }
  if (key.endsWith('s') && !key.endsWith('ss') && key.length > 3) {
    candidates.push(key.slice(0, -1));
  }
  if (key.endsWith('ed') && key.length > 3) {
    candidates.push(key.slice(0, -2));
    candidates.push(key.slice(0, -1));
  }
  if (key.endsWith('ing') && key.length > 4) {
    candidates.push(key.slice(0, -3));
    candidates.push(`${key.slice(0, -3)}e`);
  }
  return candidates;
}

const DEFAULT_PREDICATE_DICTIONARY: PredicateDictionary = {
  '좋아함': ['좋아한다', '선호한다', '선호함', '좋아함', '좋아함', '선호', 'like', 'prefer', 'favorite'],
  '사용함': ['사용한다', '사용함', '활용한다', '활용함', '쓰다', 'use', 'utilize'],
  '생성함': ['만든다', '생성한다', '생성함', '만들다', 'create', 'generate', 'make'],
  '삭제함': ['삭제한다', '삭제함', '제거한다', '제거함', '지운다', 'delete', 'remove'],
  '업데이트함': ['업데이트한다', '업데이트함', '수정한다', '수정함', '변경한다', '변경함', 'update', 'modify', 'change', 'fix'],
  '포함함': ['포함한다', '포함함', '들어있다', 'include', 'contain'],
  '의존함': ['의존한다', '의존함', '따른다', 'depend', 'rely'],
  '원인함': ['원인이다', '원인함', '일으킨다', 'cause', 'lead to'],
  '참조함': ['참조한다', '참조함', '언급한다', '언급함', 'reference', 'refer', 'mention'],
  '소유함': ['소유한다', '소유함', '가지고 있다', 'has', 'own', 'possess'],
  '속함': ['속한다', '속함', 'belong to', 'belongs to'],
  '일치함': ['일치한다', '일치함', '같다', '동일하다', 'match', 'equal', 'same'],
  '다름': ['다르다', '다름', '다르다', 'different', 'differs'],
  '연결함': ['연결한다', '연결함', '연결되어 있다', 'connect', 'link'],
  '관련함': ['관련한다', '관련함', '연관된다', '연관됨', 'related', 'relate', 'associated'],
  '필요함': ['필요하다', '필요함', '필수이다', 'required', 'need', 'necessary', 'require'],
  '지원함': ['지원한다', '지원함', '지지한다', 'support', 'back'],
  '반대함': ['반대한다', '반대함', 'oppose', 'against'],
  '따라옴': ['따라온다', '따라옴', 'follow', 'follows'],
  '선행함': ['선행한다', '선행함', 'precede', 'precedes', 'before'],
  '후행함': ['후행한다', '후행함', 'succeed', 'succeeds', 'after'],
  '해결함': ['해결한다', '해결함', 'resolve', 'solve'],
  '실행함': ['실행한다', '실행함', 'execute', 'run'],
  '종료함': ['종료한다', '종료함', 'close', 'finish'],
  '통과함': ['통과한다', '통과함', 'pass'],
  '추가함': ['추가한다', '추가함', 'add', 'append'],
};

class PredicateCanonicalizer {
  private dictionary: PredicateDictionary;
  private reverseIndex: Map<string, string> = new Map();

  constructor(customDictionary?: PredicateDictionary) {
    this.dictionary = customDictionary || DEFAULT_PREDICATE_DICTIONARY;
    this.buildReverseIndex();
  }

  private buildReverseIndex(): void {
    this.reverseIndex = new Map<string, string>();

    for (const [canonical, synonyms] of Object.entries(this.dictionary)) {
      this.reverseIndex.set(this.normalizeKey(canonical), canonical);
      for (const synonym of synonyms) {
        this.reverseIndex.set(this.normalizeKey(synonym), canonical);
      }
    }
  }

  private normalizeKey(key: string): string {
    return key.toLowerCase().trim().replace(/\s+/g, '');
  }

  canonicalize(predicate: string): PredicateCanonicalizationResult {
    if (!predicate || typeof predicate !== 'string') {
      return {
        canonical: predicate || '',
        original: predicate || '',
        success: false,
      };
    }

    const trimmed = predicate.trim();
    if (trimmed.length === 0) {
      return {
        canonical: '',
        original: predicate,
        success: false,
      };
    }

    const normalizedKey = this.normalizeKey(trimmed);
    const canonical = this.reverseIndex.get(normalizedKey)
      ?? this.resolveEnglishVariant(normalizedKey);

    if (canonical) {
      return {
        canonical,
        original: trimmed,
        success: true,
        synonym: canonical !== trimmed ? trimmed : undefined,
      };
    }

    return {
      canonical: trimmed,
      original: trimmed,
      success: false,
    };
  }

  private resolveEnglishVariant(normalizedKey: string): string | undefined {
    for (const candidate of englishStemCandidates(normalizedKey)) {
      const hit = this.reverseIndex.get(candidate);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
}

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;
const JONGSEONG_MIEUM = 16;

function jongseongIndex(char: string): number | null {
  const code = char.codePointAt(0);
  if (code === undefined || code < HANGUL_START || code > HANGUL_END) {
    return null;
  }
  return (code - HANGUL_START) % JONGSEONG_COUNT;
}

function attachParticle(word: string, withFinal: string, withoutFinal: string): string {
  const jongseong = jongseongIndex(word.slice(-1));
  return `${word}${jongseong !== null && jongseong !== 0 ? withFinal : withoutFinal}`;
}

function conjugatePredicate(predicate: string): string | null {
  const last = predicate.slice(-1);
  const jongseong = jongseongIndex(last);
  if (jongseong === null) {
    return null;
  }

  if (last === '음') {
    const stem = predicate.slice(0, -1);
    return stem ? `${stem}습니다` : null;
  }

  if (jongseong === JONGSEONG_MIEUM) {
    const code = last.codePointAt(0);
    if (code === undefined) {
      return null;
    }
    return `${predicate.slice(0, -1)}${String.fromCodePoint(code + 1)}니다`;
  }

  if (last === '다') {
    return predicate;
  }

  return `${predicate}합니다`;
}

function isUsableComponent(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\n\r]/.test(value);
}

export function buildTripleSentence(
  subject: string | undefined | null,
  predicate: string | undefined | null,
  object: string | undefined | null,
): string | null {
  if (!isUsableComponent(subject) || !isUsableComponent(predicate) || !isUsableComponent(object)) {
    return null;
  }

  const conjugated = conjugatePredicate(predicate.trim());
  if (!conjugated) {
    return null;
  }

  const subjectPart = attachParticle(subject.trim(), '은', '는');
  const objectPart = attachParticle(object.trim(), '을', '를');
  return `${subjectPart} ${objectPart} ${conjugated}`;
}

export function hasBrokenTripleConjugation(content: string): boolean {
  return /(됨|음|름)합니다/.test(content);
}

function tripleToNaturalLanguage(subject: string, predicate: string, object: string): string {
  const sentence = buildTripleSentence(subject, predicate, object);
  if (sentence) {
    return sentence;
  }

  return [subject, predicate, object]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' · ');
}

interface CandidateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  content: string;
  confidence: number | null;
  owner_id: string | null;
  project_id: string | null;
}

export interface RerenderEntry {
  id: string;
  before: string;
  after: string;
}

export interface DeletionEntry {
  id: string;
  keptId: string;
}

export interface DuplicatePlan {
  rerender: RerenderEntry[];
  deletions: DeletionEntry[];
}

const CANDIDATE_SQL = `
  WITH duplicated AS (
    SELECT content
    FROM memory_item
    WHERE type = 'semantic'
      AND is_deleted = 0
    GROUP BY content
    HAVING COUNT(*) > 1
  )
  SELECT s.id, s.subject, s.predicate, s.object, s.content,
         s.confidence, s.owner_id, s.project_id
  FROM memory_item s
  JOIN duplicated d ON s.content = d.content
  WHERE s.type = 'semantic'
    AND s.is_deleted = 0
    AND s.subject IS NOT NULL
    AND s.predicate IS NOT NULL
    AND s.object IS NOT NULL
  ORDER BY s.id
`;

function groupKey(row: CandidateRow, predicate: string): string {
  return [row.subject, predicate, row.object, row.owner_id ?? '', row.project_id ?? ''].join('\x1f');
}

function renderContent(row: CandidateRow, predicate: string): string {
  return tripleToNaturalLanguage(row.subject, predicate, row.object);
}

export function buildDuplicatePlan(db: Database.Database): DuplicatePlan {
  const canonicalizer = new PredicateCanonicalizer();
  const candidates = db.prepare(CANDIDATE_SQL).all() as CandidateRow[];

  const processed = candidates.map((row) => {
    const canonical = canonicalizer.canonicalize(row.predicate);
    const predicate = canonical.success ? canonical.canonical : row.predicate;
    const after = renderContent(row, predicate);
    return { row, predicate, after };
  });

  const rerender: RerenderEntry[] = [];
  for (const { row, after } of processed) {
    if (after !== row.content) {
      rerender.push({ id: row.id, before: row.content, after });
    }
  }

  const groups = new Map<string, Array<{ row: CandidateRow; confidence: number }>>();
  for (const { row, predicate } of processed) {
    const key = groupKey(row, predicate);
    const list = groups.get(key) ?? [];
    list.push({ row, confidence: row.confidence ?? 0 });
    groups.set(key, list);
  }

  const deletions: DeletionEntry[] = [];
  const deleteIds = new Set<string>();
  for (const members of groups.values()) {
    if (members.length <= 1) {
      continue;
    }
    const sorted = [...members].sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.row.id.localeCompare(b.row.id);
    });
    const kept = sorted[0]!;
    for (const loser of sorted.slice(1)) {
      deletions.push({ id: loser.row.id, keptId: kept.row.id });
      deleteIds.add(loser.row.id);
    }
  }

  const filteredRerender = rerender.filter((entry) => !deleteIds.has(entry.id));

  return { rerender: filteredRerender, deletions };
}
