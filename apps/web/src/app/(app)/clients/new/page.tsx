import { requireSession } from "@billow/auth";
import Link from "next/link";

import { ClientForm } from "@/app/(app)/clients/_components/client-form";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  await requireSession();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/clients"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Clients
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">New client</h1>
      <ClientForm />
    </div>
  );
}
