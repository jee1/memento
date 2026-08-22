export interface ExtractJsonObjectOptions {
  end?: 'balanced' | 'last-brace';
}

/** Extract a JSON object while ignoring braces inside quoted strings. */
export function extractJsonObjectFromLlmText(
  text: string,
  options: ExtractJsonObjectOptions = {},
): string | null {
  if (!text || typeof text !== 'string') return null;

  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;

  if (options.end === 'last-brace') {
    const lastBrace = text.lastIndexOf('}');
    return lastBrace > firstBrace ? text.substring(firstBrace, lastBrace + 1).trim() : null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index++) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === '{') depth++;
    if (character === '}') {
      depth--;
      if (depth === 0) return text.substring(firstBrace, index + 1).trim();
    }
  }

  return text.substring(firstBrace).trim();
}
