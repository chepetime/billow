export {
  type BackupEnvelope,
  openBackupEntry,
  openBackupWithRecoveryKey,
  parseBackupEnvelope,
  sealBackupEntry,
  sealBackupWithRecoveryKey,
} from "./backup-envelope";
export {
  beginSession,
  changePassword,
  createUserKeyset,
  decryptField,
  encryptField,
  isEncryptedField,
  issueRecoveryKey,
  KeyHierarchyError,
  normalizeRecoveryKey,
  resetPasswordWithRecoveryKey,
  resumeSession,
  type UserKeyset,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from "./key-hierarchy";
