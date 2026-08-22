/**
 * Triple(주어-술어-목적어) → 한국어 문장 재조립 (#768)
 *
 * `PredicateCanonicalizer`의 canonical predicate는 `사용함`·`정의됨`·`다름` 같은 ㅁ 명사화형이다.
 * 예전 템플릿(`${subject}는 ${object}를 ${predicate}합니다`)은 여기에 `합니다`를 그대로 덧붙여
 * `정의됨합니다` 같은 문장을 만들었고, 조사도 받침과 무관하게 고정이라 `시스템는`이 나왔다.
 */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;
/** 종성 ㅁ (예: 함·됨·다름) */
const JONGSEONG_MIEUM = 16;

/** 종성 인덱스. 한글 음절이 아니면 null. */
function jongseongIndex(char: string): number | null {
  const code = char.codePointAt(0);
  if (code === undefined || code < HANGUL_START || code > HANGUL_END) {
    return null;
  }
  return (code - HANGUL_START) % JONGSEONG_COUNT;
}

/** 받침이 있으면 `withFinal`, 없거나 한글이 아니면 `withoutFinal`. */
function attachParticle(word: string, withFinal: string, withoutFinal: string): string {
  const jongseong = jongseongIndex(word.slice(-1));
  return `${word}${jongseong !== null && jongseong !== 0 ? withFinal : withoutFinal}`;
}

/**
 * ㅁ 명사화형을 서술형으로 되돌린다.
 * - `…음` → `…습니다` (확인했음 → 확인했습니다)
 * - 종성 ㅁ → 종성 ㅂ + `니다` (사용함 → 사용합니다, 정의됨 → 정의됩니다, 다름 → 다릅니다)
 * - `…다` → 이미 서술형이므로 그대로 (가지고 있다)
 * - 그 외 한글 종결 → `합니다`
 */
function conjugatePredicate(predicate: string): string | null {
  const last = predicate.slice(-1);
  const jongseong = jongseongIndex(last);
  if (jongseong === null) {
    // 영문·숫자로 끝나는 predicate는 활용 규칙이 없다 (use → use합니다 방지).
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
    // ㅁ(16) → ㅂ(17): 함 → 합, 됨 → 됩, 름 → 릅
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

/**
 * triple을 한국어 문장으로 재조립한다.
 * 재조립할 수 없으면 null — 호출자는 합성 문장 대신 원문을 보존해야 한다.
 */
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

/**
 * 구 템플릿이 남긴 이중 활용(`정의됨합니다`) 탐지.
 *
 * `함합니다`는 제외한다 — `포함합니다`(포함 + 합니다)처럼 정상 문장과 문자열이 구분되지 않는다.
 * 조사만 틀린 문장도 여기서 걸러내지 않는다. 두 경우 모두 subject/predicate/object 컬럼을 가진
 * 복구 스크립트(`scripts/repair-triple-sentence-memories.ts`)가 옛 템플릿과 정확히 대조해 다시 렌더한다.
 */
export function hasBrokenTripleConjugation(content: string): boolean {
  return /(됨|음|름)합니다/.test(content);
}

/**
 * 구 템플릿이 만들었던 문장. 복구 스크립트·필터가 "기계 생성 여부"를 판정할 때 쓴다.
 */
export function legacyTripleSentence(subject: string, predicate: string, object: string): string {
  return `${subject}는 ${object}를 ${predicate}합니다`;
}
