function origin(env: Record<string, string>, name: string, pattern: RegExp) {
  const value = env[name] ?? "";
  if (!pattern.test(value)) throw new Error(`Check the HTTPS origin in ${name}`);
  return new URL(value).origin;
}

export function renderPagesHeaders(template: string, env: Record<string, string>) {
  const supabase = origin(env, "VITE_SUPABASE_URL", /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/);
  const worker = origin(env, "VITE_INGEST_URL", /^https:\/\/ship-and-ping-ingest\.[a-z0-9-]+\.workers\.dev\/?$/);
  const headers = template.replaceAll("https://supabase.invalid", supabase)
    .replaceAll("https://worker.invalid", worker);
  if (/\.invalid\b/i.test(headers)) throw new Error("Unresolved .invalid address in Pages _headers");
  return headers.trimEnd() + "\n\n/sw.js\n  Cache-Control: no-cache\n  Content-Type: application/javascript; charset=utf-8\n\n/manifest.webmanifest\n  Content-Type: application/manifest+json\n";
}
