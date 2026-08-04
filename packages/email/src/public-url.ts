/**
 * Builds the origin that links inside emails must point at.
 *
 * This exists because better-auth composes its own links from
 * `context.baseURL`, and this app deliberately leaves that as the
 * in-container `http://localhost:3000` so authentication works behind any
 * front door without pinning a domain (see packages/auth/src/auth-env.ts).
 * That default is right for auth and fatally wrong for email: a link to
 * localhost is dead in every inbox.
 *
 * Order of preference:
 *   1. An operator-configured public URL, when they want every link to point
 *      at one canonical hostname regardless of where the request arrived.
 *   2. The origin the triggering request was actually served on — the same
 *      forwarded headers `resolveTrustedOrigins` uses — but only once it has
 *      been checked against `trustedOrigins` (BILLOW_TRUSTED_ORIGINS), when
 *      the operator has set one. Without tier 1 configured, `Host` and
 *      `X-Forwarded-Host` are attacker-controlled on any request the attacker
 *      sends themselves (no cookie or same-origin restriction applies — the
 *      attacker is the client, not a victim's browser), so a raw header value
 *      can turn a password-reset email into a link that hands the reset token
 *      to a domain the attacker owns. An allowlist closes that for any
 *      operator who has pinned either a public URL or trusted origins.
 *
 * RESIDUAL RISK: an install with neither configured — the out-of-the-box LAN
 * default — still trusts the header-derived origin outright. There is no way
 * to distinguish a genuine reverse-proxy header from a forged one using
 * headers alone, and refusing to send always would break password reset on
 * every install that has not pinned a domain, which is most of them. This is
 * the documented tradeoff, not an oversight: see "Password-reset email links
 * and header trust" in apps/docs/content/docs/architecture.mdx.
 *
 * BETTER_AUTH_URL was considered as an additional pin but rejected: it is not
 * set in the shipped Umbrel deployment (only BETTER_AUTH_SECRET is), so
 * wiring it in would not change behavior for the installs that matter and
 * would just be a second, less-visible way to configure the same thing the
 * public-URL field already does.
 *
 * If none of the above yields a usable origin the caller must not send: a
 * reset email with an unreachable link is worse than no email, because the
 * token is spent and the user believes recovery is in progress.
 */

/** Hosts that are never reachable from a mail client. */
function isUnreachableHost(host: string): boolean {
  const lower = host.toLowerCase();

  // IPv6 arrives bracketed and colon-bearing ([::1]:3000), so it cannot be
  // split on ":" the way a name or IPv4 address can.
  const bracketed = /^\[([^\]]+)\]/.exec(lower);
  const bare = bracketed?.[1] ?? lower.split(":")[0] ?? "";

  return (
    bare === "localhost" ||
    bare === "0.0.0.0" ||
    bare === "::1" ||
    bare === "::" ||
    bare.startsWith("127.")
  );
}

export function normalizePublicUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isUnreachableHost(parsed.host)) return null;

  // Origin only: a stored path would be duplicated onto every link.
  return parsed.origin;
}

export function originFromHeaders(headers: Headers): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host || isUnreachableHost(host)) return null;

  const proto = headers.get("x-forwarded-proto") ?? "http";
  if (proto !== "http" && proto !== "https") return null;

  return `${proto}://${host}`;
}

/**
 * Parses BILLOW_TRUSTED_ORIGINS-shaped input (comma-separated origins) into a
 * set of normalized origins suitable for an exact match against
 * `originFromHeaders`'s output. An entry that fails to parse is dropped
 * rather than rejected outright — one typo in the list should not turn an
 * allowlist into a total outage.
 */
export function parseTrustedOriginAllowlist(
  raw: string | undefined,
): Set<string> {
  const origins = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Dropped: not a parseable origin.
    }
  }
  return origins;
}

export function resolveEmailOrigin(
  configuredPublicUrl: string | null,
  requestHeaders: Headers | null,
  trustedOrigins?: string,
): string | null {
  if (configuredPublicUrl) {
    const normalized = normalizePublicUrl(configuredPublicUrl);
    if (normalized) return normalized;
  }

  if (!requestHeaders) return null;
  const fromHeaders = originFromHeaders(requestHeaders);
  if (!fromHeaders) return null;

  // No public URL configured. Without an allowlist there is nothing left to
  // check the header-derived origin against — see the RESIDUAL RISK note
  // above. With one, a request whose forwarded host does not match it is
  // rejected outright rather than trusted, closing the gap for any operator
  // who has pinned BILLOW_TRUSTED_ORIGINS.
  const allowlist = parseTrustedOriginAllowlist(trustedOrigins);
  if (allowlist.size > 0 && !allowlist.has(fromHeaders)) return null;

  return fromHeaders;
}

/**
 * Re-points a reset link, and the callback it carries, at a reachable origin.
 *
 * Rewriting the link itself is not enough. better-auth's emailed link points
 * at its own `/reset-password/:token` endpoint, which validates the token and
 * then redirects the visitor to the `callbackURL` query parameter — resolved
 * with `new URL(callbackURL, baseURL)`. A relative callback therefore resolves
 * against the in-container `http://localhost:3000`, so a recipient who
 * followed a perfectly good link would still be bounced to a dead address.
 * Making the callback absolute up front means that resolution is a no-op.
 *
 * The absolute callback stays same-origin with the link, so better-auth's own
 * origin check over `callbackURL` still passes.
 */
export function rewriteResetLink(url: string, origin: string): string | null {
  const repointed = rewriteOrigin(url, origin);
  if (!repointed) return null;

  let parsed: URL;
  try {
    parsed = new URL(repointed);
  } catch {
    return null;
  }

  const callback = parsed.searchParams.get("callbackURL");
  if (callback) {
    try {
      // Resolves a relative callback against the reachable origin, and leaves
      // an already-absolute one alone.
      parsed.searchParams.set(
        "callbackURL",
        new URL(callback, origin).toString(),
      );
    } catch {
      return null;
    }
  }

  return parsed.toString();
}

/**
 * Re-points a URL better-auth built from its own baseURL at the origin the
 * recipient can actually reach, preserving path and query (which carry the
 * reset token).
 */
export function rewriteOrigin(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  try {
    // Rebuilt against the target origin rather than mutating `parsed`: the
    // URL spec's `host` setter leaves the existing port in place when the new
    // value omits one, so assigning it would turn a localhost:3000 link into
    // https://your-host:3000 — a broken link in every inbox.
    const target = new URL(origin);
    return new URL(
      `${parsed.pathname}${parsed.search}${parsed.hash}`,
      target.origin,
    ).toString();
  } catch {
    return null;
  }
}
