import { requireSession } from "@billow/auth";
import { buttonVariants } from "@billow/shadcn/components/button";
import type { Metadata } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { listClientCompanies } from "@/lib/workspace/clients";

export const metadata: Metadata = {
  title: "Clients",
};

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const session = await requireSession();
  const result = await listClientCompanies(session.user.id);
  // A page throws where the API answers 500: the read already logged its
  // cause, and rendering "No clients yet" for a database failure would tell
  // the user something false about their own account.
  if (!result.ok) throw new Error("Could not load clients.");
  const clients = result.data;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-normal">Clients</h1>
          <p className="text-sm text-muted-foreground">
            The companies you invoice. Used for the &ldquo;Bill To&rdquo; block.
          </p>
        </div>
        <Link href="/clients/new" className={cn(buttonVariants())}>
          New client
        </Link>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-medium">No clients yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the company you bill and its address once. Every invoice for
            them starts from it.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border bg-card">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-accent/40"
              >
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">{client.name}</p>
                  <p className="text-muted-foreground">{client.email}</p>
                  <p className="text-muted-foreground">
                    {client.cityStatePostal}, {client.country}
                  </p>
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
