import { getPrisma } from "@billow/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = { title: "Status" };

/**
 * Public status page. Boolean only, by design: versions, environment,
 * memory, counts, and error details are internal and live behind a session at
 * /admin/debug.
 */
async function isReady() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export default async function HealthPage() {
  const ready = await isReady();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden="true"
        className={
          ready
            ? "size-3 rounded-full bg-emerald-500"
            : "size-3 rounded-full bg-destructive"
        }
      />
      <h1 className="text-xl font-semibold">
        {ready ? "All systems operational" : "Service unavailable"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {ready
          ? "The application is running and can reach its database."
          : "The application is running but cannot reach its database."}
      </p>
      <p className="text-sm text-muted-foreground">
        Detailed diagnostics require sign-in:{" "}
        <Link
          href="/admin/debug"
          className="text-primary underline underline-offset-4"
        >
          /admin/debug
        </Link>
      </p>
    </main>
  );
}
