"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@billow/shadcn/components/button";
import { authClient } from "@billow/auth/client";
import { notifyError, notifySuccess } from "@/lib/notify";

export type SessionSummary = {
  id: string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** True for the session making this request, which is never revocable here. */
  current: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: Date | string) {
  return `${dateFormatter.format(new Date(value))} UTC`;
}

/**
 * Turn a user-agent string into something an operator can recognise.
 *
 * Deliberately coarse. The goal is "is this the laptop or the phone", not
 * accurate client detection — and a wrong-but-confident label is worse than a
 * vague one when the decision it informs is "revoke this or not".
 */
function describeClient(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";

  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : null;

  const platform =
    /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "Unknown device";
}

export function SessionsSection({ sessions }: { sessions: SessionSummary[] }) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  async function revoke(session: SessionSummary) {
    setRevoking(session.token);
    const { error } = await authClient.revokeSession({ token: session.token });
    setRevoking(null);

    if (error) {
      notifyError("Session not signed out", error.message ?? undefined);
      return;
    }

    notifySuccess(
      "Signed out",
      `${describeClient(session.userAgent)} no longer has access.`,
    );
    router.refresh();
  }

  async function revokeOthers() {
    setRevokingOthers(true);
    const { error } = await authClient.revokeOtherSessions();
    setRevokingOthers(false);

    if (error) {
      notifyError("Sessions not signed out", error.message ?? undefined);
      return;
    }

    notifySuccess(
      "Signed out everywhere else",
      "Only this device is still signed in.",
    );
    router.refresh();
  }

  const others = sessions.filter((session) => !session.current);

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold">Active sessions</h2>
        <p className="text-sm text-muted-foreground">
          Every device currently signed in to this account. Signing one out
          takes effect immediately.
        </p>
      </div>

      <ul className="space-y-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"
          >
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {describeClient(session.userAgent)}
                {session.current ? (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    This device
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {session.ipAddress ? `${session.ipAddress} · ` : ""}
                Signed in {formatDate(session.createdAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                Expires {formatDate(session.expiresAt)}
              </p>
            </div>

            {session.current ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={revoking === session.token}
                onClick={() => revoke(session)}
              >
                {revoking === session.token ? "Signing out..." : "Sign out"}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {others.length > 0 ? (
        <Button
          type="button"
          variant="destructive"
          disabled={revokingOthers}
          onClick={revokeOthers}
        >
          {revokingOthers
            ? "Signing out..."
            : `Sign out all other devices (${others.length})`}
        </Button>
      ) : null}
    </section>
  );
}
