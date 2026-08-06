import { requireSession } from "@billow/auth";
import Link from "next/link";

import { SenderForm } from "@/app/(app)/senders/_components/sender-form";

export const dynamic = "force-dynamic";

export default async function NewSenderPage() {
  await requireSession();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/senders"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Sender profiles
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">New sender</h1>
      <SenderForm />
    </div>
  );
}
