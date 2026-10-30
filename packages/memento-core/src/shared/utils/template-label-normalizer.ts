/**
 * #1225: the 5-line memory record template repeats the same labels in every entry.
 * Those labels alone lift MiniLM cosine similarity between unrelated records above the
 * consolidation threshold, so clustering compares the text without them.
 */
const TEMPLATE_LABEL_RE = /^[ \t]*(?:-[ \t]*)?(?:결정|근거|버린 대안|안 통한 것|다음 걸림돌)[ \t]*:[ \t]*/gm;

export function stripMemoryTemplateLabels(text: string): string {
  return text.replace(TEMPLATE_LABEL_RE, '');
}
