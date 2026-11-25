/** 요청문에 들어갈 외부 문자열의 검사와 표시가 같은 문자를 보도록 한다. */
export function normalizePromptInput(value: string): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,
      "",
    )
    .replace(/[\r\n\u0085\u2028\u2029]+/gu, " ")
    .trim();
}
