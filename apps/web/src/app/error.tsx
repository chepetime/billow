"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-start justify-center gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        The page failed to render. Details below help with debugging.
      </p>
      <dl className="w-full space-y-2 rounded-lg border bg-card p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Message</dt>
          <dd className="font-mono break-words">{error.message || "—"}</dd>
        </div>
        {error.digest ? (
          <div>
            <dt className="text-muted-foreground">Digest</dt>
            <dd className="font-mono">{error.digest}</dd>
          </div>
        ) : null}
      </dl>
      <p className="text-sm text-muted-foreground">
        For full server-side diagnostics open{" "}
        <a
          href="/api/health"
          className="text-primary underline underline-offset-4"
        >
          /api/health
        </a>
        .
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
