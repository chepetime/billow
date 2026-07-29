export {
  EMAIL_CAPABILITY_UNKNOWN,
  resolveEmailCapability,
  type EmailCapability,
  type EmailCapabilityInput,
} from "./capability";

export {
  CredentialCryptoError,
  decryptCredential,
  encryptCredential,
  previewCredential,
} from "./crypto";

export {
  isSupportedProvider,
  SUPPORTED_PROVIDERS,
  type EmailProvider,
  type OutgoingEmail,
  type ProviderName,
  type SendResult,
} from "./provider";

export {
  normalizePublicUrl,
  originFromHeaders,
  resolveEmailOrigin,
  rewriteOrigin,
  rewriteResetLink,
} from "./public-url";

export {
  clearEmailVerification,
  formatFromAddress,
  getConfiguredPublicUrl,
  getEmailCapability,
  getPublicEmailSettings,
  getSendingCredentials,
  isValidEmail,
  markEmailVerified,
  updateEmailSettings,
  type EmailSettingsUpdate,
  type PublicEmailSettings,
} from "./settings";

export { sendEmail, type RenderedMessage } from "./send";
