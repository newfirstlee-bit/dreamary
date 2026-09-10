export type AiReplyLocale = 'ko' | 'ja' | string | undefined;

const NON_KOREAN_LANGUAGE_PATTERN =
  /[A-Za-z]+|[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u0400-\u04FF\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F\u0900-\u097F\u0370-\u03FF]+/g;

export function findUnexpectedLanguageSegments(text: string, locale: AiReplyLocale) {
  if (locale !== 'ko' || !text) return [];

  const found = text.match(NON_KOREAN_LANGUAGE_PATTERN) || [];
  return Array.from(new Set(found.map((segment) => segment.trim()).filter(Boolean)));
}

export function hasUnexpectedLanguageSegments(text: string, locale: AiReplyLocale) {
  return findUnexpectedLanguageSegments(text, locale).length > 0;
}

export function getKoreanOnlyRetryInstruction() {
  return `
[출력 검수 규칙]
반드시 한국어만 사용하세요.
영어 알파벳, 일본어, 중국어 한자, 기타 외국어 문자, 의미 없는 코드 조각을 절대 출력하지 마세요.
캐릭터 이름이나 고유명사가 외국어처럼 보이더라도 답변 문장 안에서는 한국어 자연문만 사용하세요.
`;
}
