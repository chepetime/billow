/**
 * Derives the set of origins BetterAuth should trust for its cross-site
 * (CSRF) check.
 *
 * The origin is built from the host the request was actually served on
 * (`x-forwarded-host`/`host` plus `x-forwarded-proto`), never from the
 * request's own `Origin` header — trusting `Origin` back to itself would let
 * any attacker origin validate itself, which defeats the check entirely.
 */
export function resolveTrustedOrigins(
  headers: Headers,
  configured?: string,
): string[] {
  const origins = new Set<string>();

  for (const raw of (configured ?? "").split(",")) {
    const trimmed = raw.trim();
    if (trimmed) {
      origins.add(trimmed);
    }
  }

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? "http";
    origins.add(`${proto}://${host}`);
  }

  return [...origins];
}
