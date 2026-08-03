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
 * Deliberately does NOT set `Strict-Transport-Security`. This app is served
 * over plain HTTP at `umbrel.local:46247` by default; HSTS on an HTTP origin
 * is a no-op for that path, and if a user later reaches the same origin over
 * HTTPS through a tunnel, a previously-cached HSTS header would pin the
 * browser to HTTPS-only for this host — which can lock the user out entirely
 * if the tunnel goes away and they fall back to the plain-HTTP local address.
 * HSTS should only be added once this app is served exclusively over HTTPS.
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
