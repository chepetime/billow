/**
 * Shared holder for the hooks the host app plugs into this package.
 *
 * These live on `globalThis` rather than in module scope, for the same reason
 * `getPrisma()` does in @billow/db. Next.js compiles `instrumentation.ts` into
 * its own bundle, separate from route handlers and server components, and a
 * module imported by both can be instantiated more than once. A plain
 * module-level `let` assigned during `register()` is therefore invisible to
 * the copy that route code actually calls — the registration appears to
 * succeed and the hook silently never fires.
 *
 * That is not hypothetical: it is exactly how password-reset delivery failed
 * silently. `sendResetPassword` ran, the token was issued, and the mailer was
 * never invoked, with nothing logged anywhere to say so.
 */

import type { AuthMailer } from "./mailer";
import type { AuthErrorReporter } from "./session";

interface AuthRegistry {
  errorReporter?: AuthErrorReporter;
  mailer?: AuthMailer;
}

const globalForAuth = globalThis as unknown as {
  __billowAuthRegistry?: AuthRegistry;
};

export function authRegistry(): AuthRegistry {
  globalForAuth.__billowAuthRegistry ??= {};
  return globalForAuth.__billowAuthRegistry;
}
