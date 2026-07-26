import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Account identity helpers.
 *
 * The database is never reset between specs (one Postgres container for the
 * whole run, in CI and locally), so every account this suite creates keys on
 * a random suffix. That keeps reruns against a warm database valid instead of
 * colliding with rows a previous run left behind, and makes accounts from
 * different test files trivially distinguishable in the admin users list.
 */
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export function uniqueEmail(label: string): string {
  return `billow-e2e-${label}-${uniqueSuffix()}@example.com`;
}

export function uniqueUsername(label: string): string {
  // Letters, digits, dots, underscores and hyphens only (see usernameSchema
  // in apps/web/src/lib/schemas/auth.ts) — no "@", so this never collides
  // with the email-vs-username detection in lib/login-identifier.ts.
  return `billowe2e${label}${uniqueSuffix()}`.toLowerCase();
}

const AUTH_DIR = path.join(import.meta.dirname, "..", "..", ".auth");
export const OWNER_STORAGE_STATE_PATH = path.join(AUTH_DIR, "owner.json");
const OWNER_CREDENTIALS_PATH = path.join(AUTH_DIR, "owner-credentials.json");

export type OwnerCredentials = {
  name: string;
  email: string;
  password: string;
  /** Set once tests/auth-flows.spec.ts assigns a username via /settings/account. */
  username?: string;
};

/** Written once by tests/setup/first-run.setup.ts after registering the owner account. */
export async function saveOwnerCredentials(
  credentials: OwnerCredentials,
): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(
    OWNER_CREDENTIALS_PATH,
    JSON.stringify(credentials, null, 2),
    "utf-8",
  );
}

/** Read by every other spec that needs to sign in as, or identify, the owner account. */
export async function readOwnerCredentials(): Promise<OwnerCredentials> {
  const raw = await readFile(OWNER_CREDENTIALS_PATH, "utf-8");
  return JSON.parse(raw) as OwnerCredentials;
}

/**
 * Records the username tests/auth-flows.spec.ts assigns to the owner account,
 * so a later run of the same spec (or a different spec that wants to sign in
 * by username) can reuse it instead of assuming a fixed value.
 */
export async function updateOwnerUsername(username: string): Promise<void> {
  const current = await readOwnerCredentials();
  await saveOwnerCredentials({ ...current, username });
}
