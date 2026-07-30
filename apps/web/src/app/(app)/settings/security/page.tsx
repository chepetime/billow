import { headers } from "next/headers";

import {
  SessionsSection,
  type SessionSummary,
} from "@/app/(app)/_components/sessions-section";
import { TwoFactorSection } from "@/app/(app)/_components/two-factor-section";
import { auth, requireSession } from "@billow/auth";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

/**
 * Active sessions for the signed-in account.
 *
 * The session token reaches the browser because that is what BetterAuth's
 * `revokeSession` takes as its identifier. These are the user's own tokens on
 * their own authenticated, `force-dynamic` page — but it does mean the markup
 * carries live credentials, which is part of why the CSP forbids third-party
 * script and connect sources.
 */
async function listSessions(currentToken: string): Promise<SessionSummary[]> {
  try {
    const sessions = await auth.api.listSessions({ headers: await headers() });
    return sessions
      .map((session) => ({
        id: session.id,
        token: session.token,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        current: session.token === currentToken,
      }))
      // Current device first, then most recently signed in.
      .sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  } catch (error) {
    await recordError("listSessions", error);
    return [];
  }
}

export default async function SecuritySettingsPage() {
  const session = await requireSession();
  const user = session.user as typeof session.user & {
    twoFactorEnabled?: boolean | null;
  };
  const sessions = await listSessions(session.session.token);

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Security</h1>
        <p className="text-sm text-muted-foreground">
          Protect your account with an additional sign-in step, and review where
          it is signed in.
        </p>
      </div>

      <TwoFactorSection enabled={Boolean(user.twoFactorEnabled)} />

      {sessions.length > 0 ? <SessionsSection sessions={sessions} /> : null}
    </div>
  );
}
