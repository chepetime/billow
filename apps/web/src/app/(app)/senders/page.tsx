import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import Link from "next/link";

import { EncryptionNotice } from "@/app/(app)/_components/encryption-notice";
import { cn } from "@/lib/utils";
import { listSenderProfiles } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

export default async function SendersPage() {
  const session = await requireSession();
  const { profiles, encrypted } = await listSenderProfiles(session.user.id);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-normal">
            Sender profiles
          </h1>
          <p className="text-sm text-muted-foreground">
            Who the invoice is from. Used for the &ldquo;From&rdquo; block.
          </p>
        </div>
        <Link href="/senders/new" className={cn(buttonVariants())}>
          New profile
        </Link>
      </div>

      <EncryptionNotice encrypted={encrypted} />

      {profiles.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-medium">No sender profiles yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An invoice needs one. Add your name, legal name, and address, and
            every invoice you create will start from it.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border bg-card">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <Link
                href={`/senders/${profile.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-accent/40"
              >
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-muted-foreground">{profile.legalName}</p>
                  <p className="text-muted-foreground">{profile.email}</p>
                </div>
                <span className="text-sm text-muted-foreground">Edit</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
