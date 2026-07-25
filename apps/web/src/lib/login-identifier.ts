/**
 * Sign-in accepts either a username or an email address in one field.
 * An "@" is what distinguishes them: usernames cannot contain one.
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}
