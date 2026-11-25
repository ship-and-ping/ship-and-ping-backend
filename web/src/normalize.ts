/** 요청문에 들어갈 외부 문자열의 검사와 표시가 같은 문자를 보도록 한다. */
function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,
      "",
    )
    .replace(/[\r\n\v\f\u0085\u2028\u2029]+/gu, " ");
}

export function normalizePromptInput(value: string): string {
  return normalizeText(value).trim();
}

/** Returns plain text for JSX text nodes and input values. */
export function displayText(
  value: string,
  field: "app-data" | "login-email" = "app-data",
): string {
  if (field === "login-email") return value;
  return normalizeText(value)
    .replace(/[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/gi, "[가림]")
    .replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, "[가림]")
    .replace(/Bearer\s+\S+|eyJ[a-z0-9._=-]+/gi, "[가림]")
    .replace(
      /(?:sp_(?:srv|pub)|sb_(?:secret|publishable))_[a-z0-9_.=+-]*|\b(?:sk|pk|rk)_[a-z0-9]{16,}[a-z0-9_.=+-]*/gi,
      "[가림]",
    );
}
