"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@billow/shadcn/components/button";
import { authClient } from "@/lib/auth-client";
import { notifyError, notifySuccess } from "@/lib/notify";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  createdAt: string | Date;
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString();
}

export function UsersSection({
  users,
  currentUserId,
}: {
  users: AdminUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function run(
    id: string,
    label: string,
    action: () => Promise<{ error?: { message?: string } | null }>,
  ) {
    setPendingId(id);
    const { error } = await action();
    setPendingId(null);

    if (error) {
      notifyError(`${label} failed`, error.message ?? undefined);
      return;
    }

    notifySuccess(label);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Users ({users.length})</h2>
        <p className="text-sm text-muted-foreground">
          The first account to register administers this installation. You
          cannot change your own role or remove your own account here.
        </p>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users loaded.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {users.map((user) => {
            const self = user.id === currentUserId;
            const admin = user.role === "admin";
            const busy = pendingId === user.id;

            return (
              <li
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium">
                    {user.name}
                    {self ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        you
                      </span>
                    ) : null}
                    {admin ? (
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">
                        admin
                      </span>
                    ) : null}
                    {user.banned ? (
                      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        banned
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email} · joined {formatDate(user.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || self}
                    onClick={() =>
                      run(user.id, admin ? "Role set to user" : "Role set to admin", () =>
                        authClient.admin.setRole({
                          userId: user.id,
                          role: admin ? "user" : "admin",
                        }),
                      )
                    }
                  >
                    {admin ? "Demote" : "Make admin"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || self}
                    onClick={() =>
                      run(user.id, user.banned ? "User unbanned" : "User banned", () =>
                        user.banned
                          ? authClient.admin.unbanUser({ userId: user.id })
                          : authClient.admin.banUser({ userId: user.id }),
                      )
                    }
                  >
                    {user.banned ? "Unban" : "Ban"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(user.id, "Sessions revoked", () =>
                        authClient.admin.revokeUserSessions({ userId: user.id }),
                      )
                    }
                  >
                    Revoke sessions
                  </Button>

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy || self}
                    onClick={() =>
                      run(user.id, "User removed", () =>
                        authClient.admin.removeUser({ userId: user.id }),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
