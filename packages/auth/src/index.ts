import "server-only";

export { getAdminSession, isAdmin, requireAdmin } from "./admin";
export { auth } from "./auth";
export {
  confirmRecoveryKeySaved,
  DATA_KEY_COOKIE,
  dataKeyCookies,
  getDataKey,
  getRecoveryKeyState,
  issueRecoveryKeyFor,
  needsAccessRestored,
  needsRecoveryKey,
  type RecoveryKeyState,
  restoreAccessWithRecoveryKey,
} from "./data-key";
export {
  type AuthMailer,
  type PasswordResetMessage,
  setAuthMailer,
} from "./mailer";
export { getRegistrationEnabled } from "./registration-settings";
export {
  type AuthErrorReporter,
  getSession,
  requireGuest,
  requireSession,
  setAuthErrorReporter,
} from "./session";
