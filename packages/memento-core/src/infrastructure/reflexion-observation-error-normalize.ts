/** Reflexion 관찰 dedup 키용 오류 문구 정규화 (#1578). 가변 id·시각·숫자를 치환한다. */
export function normalizeReflexionObservationErrorMessage(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    '<id>'
  );
  s = s.replace(/\bmem_[a-z0-9_-]+\b/gi, '<id>');
  s = s.replace(/\bfailure[-_][a-z0-9]+\b/gi, '<id>');
  s = s.replace(
    /\b\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?\b/gi,
    '<time>'
  );
  s = s.replace(/\b\d+\b/g, '<n>');
  return s.replace(/\s+/g, ' ').trim();
}
