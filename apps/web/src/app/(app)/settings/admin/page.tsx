import Link from "next/link";
import { headers } from "next/headers";

import { BackupSection } from "@/app/(app)/settings/_components/backup-section";
import { UsersSection, type AdminUser } from "@/app/(app)/settings/_components/users-section";
import { auth, requireAdmin } from "@billow/auth";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

export const metadata = { title: "Administration" };

async function listUsers(): Promise<AdminUser[]> {
  try {
    const result = await auth.api.listUsers({
      headers: await headers(),
      query: { limit: 100, sortBy: "createdAt", sortDirection: "asc" },
    });
    const users = Array.isArray(result) ? result : (result?.users ?? []);
    return users as AdminUser[];
  } catch (error) {
    await recordError("admin.listUsers", error);
    return [];
  }
}

export default async function AdminPage() {
  const session = await requireAdmin();
  const users = await listUsers();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">
          Administration
        </h1>
        <p className="text-sm text-muted-foreground">
          Installation-wide controls. Only administrators can see this page.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Diagnostics</h2>
          <p className="text-sm text-muted-foreground">
            Runtime state: container limits, database, network resolution,
            request headers, environment, and recent errors.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/debug"
            className="text-sm text-primary underline underline-offset-4"
          >
            Open diagnostics
          </Link>
          <a
            href="/api/admin/diagnostics"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Raw JSON
          </a>
          <a
            href="/api/health"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Public status probe
          </a>
        </div>
      </section>

      <UsersSection users={users} currentUserId={session.user.id} />

      <BackupSection />
    </div>
  );
}
