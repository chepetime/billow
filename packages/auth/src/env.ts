// Pure, side-effect-free auth logic: no `server-only`, no Next.js, no
// Prisma/database imports. This is what makes the security-critical rules
// here (secret/URL validation, trusted-origin derivation, and the
// registration gate) directly unit-testable without a server or a database.
export { type AuthEnv, getAuthEnv } from "./auth-env";
export { canRegister } from "./registration";
export { resolveTrustedOrigins } from "./trusted-origins";
