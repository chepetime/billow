/**
 * Production security-header policy, applied to every route from
 * `next.config.ts`.
 *
 * This app is self-hosted (Umbrel, plain HTTP on `umbrel.local:46247`) and
 * may also be reached through an HTTPS tunnel. That constrains a couple of
 * choices below — see the comments inline.
 */

/**
 * Content-Security-Policy directives.
 *
 * In development only, `script-src` also gets `'unsafe-eval'`. React's dev
 * build uses `eval()` for debugging features such as reconstructing
 * callstacks across environments, and without it the dev overlay reports a
 * console error and those features silently stop working. React never uses
 * `eval()` in a production build, so the shipped policy is unaffected — this
 * is the one place the two policies deliberately differ.
 *
 * `script-src` includes `'unsafe-inline'` as a known, deliberate weakening:
 * `next-themes` (see `src/components/theme-provider.tsx`) injects a small
 * inline `<script>` into the document `<head>` that sets the theme class
 * before first paint, to avoid a flash of the wrong theme. Next.js itself
 * may also inject small inline bootstrap scripts. Neither is nonce-tagged
 * today, so `'self'` alone white-screens the app.
 *
 * `src/proxy.ts` does now exist (it guards `/dashboard` and `/settings`), so
 * injecting a per-request nonce is a matter of widening its matcher and
 * passing the nonce to `next-themes`, rather than introducing a new mechanism.
 * When that happens, tighten this back to `'self' 'nonce-<value>'` and drop
 * `'unsafe-inline'`.
 *
 * `style-src` keeps `'unsafe-inline'` for the same reason (Next.js emits
 * inline `style` attributes/tags, and `@scalar/api-reference-react` on
 * `/docs/api` injects its own inline styles at runtime).
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${IS_PRODUCTION ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Permissions-Policy: explicitly deny device/browser capabilities this app
 * never uses.
 */
const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * The full production security-header set, in the shape Next.js'
 * `headers()` config expects (`{ key, value }[]`).
 *
 * Deliberately does NOT set `Strict-Transport-Security`, even conditionally.
 * This was reconsidered alongside the data-key cookie's `secure` flag (see
 * `dataKeyCookieIsSecure` in `packages/auth/src/data-key.ts`), which *is*
 * made conditional on `x-forwarded-proto === "https"` — a cookie without
 * `secure` is simply sent again next request, so getting the condition wrong
 * costs one request's confidentiality at worst. HSTS has no equivalent
 * escape hatch: once a browser receives it, it refuses plain HTTP to this
 * host for the full `max-age`, unprompted and un-skippable, on every future
 * visit. A user who reaches this same instance over a tunnel today and the
 * plain-HTTP LAN address tomorrow (the tunnel host being down, a VPN not
 * connected, `x-forwarded-proto` briefly wrong behind a misconfigured
 * proxy) would find the app entirely unreachable, with no in-app fix — the
 * exact lockout this security work must avoid causing. That risk is not
 * reduced by a short `max-age`; it is only bounded in time.
 *
 * There is also no clean way to gate this header on the request the way the
 * cookie is gated: this array is handed to Next.js' static `headers()`
 * config (`next.config.ts`), which supports per-request conditions only via
 * its `has`/`missing` matchers (documented under "Header, Cookie, and Query
 * Matching" in the Next.js `headers()` config reference) — a routing-layer
 * mechanism, not something this module's plain array can express on its
 * own. Wiring that in would mean duplicating this list behind a
 * `has: [{ type: "header", key: "x-forwarded-proto", value: "https" }]`
 * rule in `next.config.ts`, which does not change the risk above.
 *
 * `x-forwarded-proto` is also attacker-controllable whenever nothing in
 * front of this app overwrites it (a bare `docker run` with no reverse
 * proxy) — worth naming even though it does not change the call here: a
 * forged `https` value could only ever expose the *forging* request to
 * HSTS's downside, never anyone else's, so it does not add a new class of
 * risk. It is the permanence and blast radius of HSTS on a single genuine
 * user's own follow-up requests, not the header's trustworthiness, that
 * keeps it off. Add it only once this app is served exclusively over HTTPS.
 */
export const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Belt-and-suspenders with CSP's frame-ancestors: X-Frame-Options covers
  // older browsers that don't honor frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
];
