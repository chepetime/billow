/**
 * Shown when this request could not reach the user's data key.
 *
 * The encrypted columns come back as ciphertext in that state, and the honest
 * move is to say so — printing `encv1.…` into a form field and letting the
 * user save it would write the envelope back as if it were the value.
 */
export function EncryptionNotice({ encrypted }: { encrypted: boolean }) {
  if (encrypted) return null;

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="text-sm font-medium">Encrypted fields are locked</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This session cannot reach your encryption key, so tax IDs, addresses and
        bank details are unreadable and must not be saved from here. Sign out
        and back in to unlock them.
      </p>
    </div>
  );
}
