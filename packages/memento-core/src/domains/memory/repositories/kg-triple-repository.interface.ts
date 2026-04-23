/**
 * KgTriple Repository Interface (Issue #90)
 */

export interface KgTripleRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  owner_id: string | null;
  process_id: string | null;
  session_id: string | null;
  representative_memory_id: string | null;
  created_at: string;
}

export interface UpsertTripleInput {
  subject: string;
  predicate: string;
  object: string;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  representative_memory_id?: string | null;
}

export interface IKgTripleRepository {
  /**
   * 동일 (subject, predicate, object)이면 기존 id 반환, 없으면 삽입 후 id 반환.
   * representative_memory_id는 새로 삽입할 때만 설정하고, 기존 행은 갱신하지 않음.
   */
  upsertTriple(input: UpsertTripleInput): string;

  getBySubjectPredicateObject(
    subject: string,
    predicate: string,
    object: string
  ): KgTripleRow | null;
}
