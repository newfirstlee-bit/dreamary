export type KoreanJosaPair =
  | '이/가'
  | '을/를'
  | '은/는'
  | '으로/로'
  | '과/와'
  | '아/야';

/**
 * Dreamary 한국어 조사 처리 공통 유틸.
 *
 * 지원 케이스:
 * - 이/가: 받침 있음 "이", 받침 없음 "가"       예) 도윤이 / 루나가
 * - 을/를: 받침 있음 "을", 받침 없음 "를"       예) 도윤을 / 루나를
 * - 은/는: 받침 있음 "은", 받침 없음 "는"       예) 도윤은 / 루나는
 * - 으로/로: 받침 있음 "으로", 받침 없음 "로"
 *   - 단, 받침이 ㄹ이면 "로"                    예) 길로 / 도윤으로 / 루나로
 * - 과/와: 받침 있음 "과", 받침 없음 "와"       예) 도윤과 / 루나와
 * - 아/야: 받침 있음 "아", 받침 없음 "야"       예) 도윤아 / 루나야
 *
 * 템플릿 치환 지원:
 * - {유저}가 / {유저}이                         예) 지민이 / 하루가
 * - {유저}을 / {유저}를                         예) 지민을 / 하루를
 * - {유저}은 / {유저}는                         예) 지민은 / 하루는
 * - {유저}으로 / {유저}로                       예) 도윤으로 / 길로 / 루나로
 * - {유저}과 / {유저}와                         예) 지민과 / 하루와
 * - {유저}아 / {유저}야                         예) 지민아 / 하루야
 * - {캐릭터}도 위와 동일하게 처리
 * - 조사 없이 {유저}, {캐릭터}만 있으면 이름만 치환
 *
 * 비한글·영문·숫자로 끝나는 이름은 현재 첫 번째 조사를 사용한다.
 * 예) Alex이, D를
 * 영문 발음 기반 조사는 추후 별도 규칙 확정 후 확장한다.
 */

const HANGUL_BASE_CODE = 44032;
const HANGUL_LAST_CODE = 55203;
const HANGUL_JONGSEONG_COUNT = 28;
const RIEUL_JONGSEONG_INDEX = 8;

function getLastHangulCode(word: string) {
  if (!word) return 0;
  return word.trim().charCodeAt(word.trim().length - 1);
}

function isHangulSyllableCode(code: number) {
  return code >= HANGUL_BASE_CODE && code <= HANGUL_LAST_CODE;
}

export function hasKoreanBatchim(word: string) {
  const lastChar = getLastHangulCode(word);
  if (!isHangulSyllableCode(lastChar)) return false;
  return (lastChar - HANGUL_BASE_CODE) % HANGUL_JONGSEONG_COUNT !== 0;
}

export function hasKoreanRieulBatchim(word: string) {
  const lastChar = getLastHangulCode(word);
  if (!isHangulSyllableCode(lastChar)) return false;
  return (lastChar - HANGUL_BASE_CODE) % HANGUL_JONGSEONG_COUNT === RIEUL_JONGSEONG_INDEX;
}

export function getKoreanJosa(word: string, josaPair: KoreanJosaPair) {
  if (!word) return josaPair.split('/')[0];

  const lastChar = getLastHangulCode(word);
  const [withBatchim, withoutBatchim] = josaPair.split('/');
  if (!isHangulSyllableCode(lastChar)) return withBatchim;

  if (josaPair === '으로/로' && hasKoreanRieulBatchim(word)) {
    return withoutBatchim;
  }

  return hasKoreanBatchim(word) ? withBatchim : withoutBatchim;
}

export function applyKoreanJosa(word: string, josaPair: KoreanJosaPair) {
  if (!word) return '';
  return `${word}${getKoreanJosa(word, josaPair)}`;
}

const JOSA_TO_PAIR: Record<string, KoreanJosaPair> = {
  이: '이/가',
  가: '이/가',
  을: '을/를',
  를: '을/를',
  은: '은/는',
  는: '은/는',
  으로: '으로/로',
  로: '으로/로',
  과: '과/와',
  와: '과/와',
  아: '아/야',
  야: '아/야',
};

export interface KoreanNameTemplateNames {
  userName: string;
  characterName: string;
}

function replaceKoreanPlaceholderWithJosa(text: string, placeholder: string, name: string) {
  const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const josaPattern = /(으로|이|가|을|를|은|는|로|과|와|아|야)/g;
  return text.replace(new RegExp(`${escapedPlaceholder}${josaPattern.source}`, 'g'), (_match, josa: string) => {
    const pair = JOSA_TO_PAIR[josa];
    return pair ? applyKoreanJosa(name, pair) : `${name}${josa}`;
  });
}

export function formatKoreanNameTemplate(template: string, names: KoreanNameTemplateNames) {
  if (!template) return '';

  let text = template;
  text = replaceKoreanPlaceholderWithJosa(text, '{유저}', names.userName);
  text = replaceKoreanPlaceholderWithJosa(text, '{캐릭터}', names.characterName);

  return text
    .replace(/{유저}/g, names.userName)
    .replace(/{캐릭터}/g, names.characterName)
    .replace(/{ユーザー}/g, names.userName)
    .replace(/{キャラクター}/g, names.characterName);
}
