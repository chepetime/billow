export {
  EMAIL_CAPABILITY_UNKNOWN,
  type EmailCapability,
  type EmailCapabilityInput,
  resolveEmailCapability,
} from "./capability";

export {
  CredentialCryptoError,
  decryptCredential,
  encryptCredential,
  previewCredential,
} from "./crypto";

export {
  type EmailProvider,
  isSupportedProvider,
  type OutgoingEmail,
  type ProviderName,
  type SendResult,
  SUPPORTED_PROVIDERS,
} from "./provider";

export {
  normalizePublicUrl,
  originFromHeaders,
  parseTrustedOriginAllowlist,
  resolveEmailOrigin,
  rewriteOrigin,
  rewriteResetLink,
} from "./public-url";
export { type RenderedMessage, sendEmail } from "./send";
export {
  clearEmailVerification,
  type EmailSettingsUpdate,
  formatFromAddress,
  getConfiguredPublicUrl,
  getEmailCapability,
  getPublicEmailSettings,
  getSendingCredentials,
  isValidEmail,
  markEmailVerified,
  type PublicEmailSettings,
  updateEmailSettings,
} from "./settings";
