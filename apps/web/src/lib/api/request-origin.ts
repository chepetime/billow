import "server-only";

/** Reject cookie-authenticated mutations that did not originate from this app. */
export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return origin === new URL(request.url).origin;

  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (request.url.startsWith("https:") ? "https" : "http");
  return origin === `${protocol}://${host}`;
}
