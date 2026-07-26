export function canRegister(
  userCount: number,
  registrationEnabled: boolean,
): boolean {
  return userCount === 0 || registrationEnabled;
}
