import "server-only";

export { auth } from "./auth";
export {
  getSession,
  requireSession,
  requireGuest,
  setAuthErrorReporter,
  type AuthErrorReporter,
} from "./session";
export { isAdmin, requireAdmin, getAdminSession } from "./admin";
export {
  setAuthMailer,
  type AuthMailer,
  type PasswordResetMessage,
} from "./mailer";
export { getRegistrationEnabled } from "./registration-settings";
export {
  getDataKey,
  getRecoveryKeyState,
  needsRecoveryKey,
  issueRecoveryKeyFor,
  confirmRecoveryKeySaved,
  DATA_KEY_COOKIE,
  type RecoveryKeyState,
} from "./data-key";
