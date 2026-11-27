const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const deployment = new RegExp(
  "^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2}))(?:-(" + uuid + "))?$", "i",
);
const deploymentId = new RegExp("^" + uuid + "$", "i");
/** @param {string} raw */
export function versionLabel(raw) {
  // Validate the entire original field before using any of it outside the data block.
  if (raw.length <= 64 && !/\s/.test(raw)) {
    if (/^[a-f0-9]{7,40}$/i.test(raw) && (/[a-f]/i.test(raw) || raw.length > 13)) return raw.slice(0, 7);
    if (deploymentId.test(raw)) return raw.slice(0, 8);
    const match = deployment.exec(raw);
    if (match && Number.isFinite(Date.parse(match[1]))) {
      const kst = new Date(Date.parse(match[1]) + 9 * 3600000).toISOString();
      return kst.slice(5, 10).replace("-", "/") + " " + kst.slice(11, 16) + " 배포" +
        (match[2] ? " · " + match[2].slice(0, 8) : "");
    }
  }
  const masked = redactVersionTokens(raw);
  if (/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(raw) && !/[^a-z0-9._+-]/i.test(raw) && masked === raw)
    return raw;
  return null;
}

/** @param {string} text */
export function redactVersionTokens(text) {
  return text.replace(/(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_)[a-z0-9_.=-]+|(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}/gi, "[가림]")
    .replace(/(?<![a-z0-9])(?:gh[pos]_|github_pat_|sk-|glpat-|xox[abpr]-|AKIA|ASIA|AIza|eyJ)[a-z0-9_.=+\/-]+/gi, "[가림]")
    .replace(/[a-z0-9+/_-]{32,}={0,2}/gi, "[가림]");
}
