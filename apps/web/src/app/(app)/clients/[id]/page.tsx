import { requireSession } from "@billow/auth";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientForm } from "@/app/(app)/clients/_components/client-form";
import { listClientCompanies } from "@/lib/workspace-records";

export const dynamic = "force-dynamic";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const clientId = Number.parseInt(id, 10);

  if (Number.isNaN(clientId)) notFound();

  const { clients } = await listClientCompanies(session.user.id);
  const client = clients.find((candidate) => candidate.id === clientId);

  if (!client) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Link
        href="/clients"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Clients
      </Link>
      <h1 className="text-2xl font-semibold tracking-normal">{client.name}</h1>

      <ClientForm
        id={client.id}
        defaultValues={{
          name: client.name,
          legalName: client.legalName ?? "",
          address1: client.address1,
          address2: client.address2 ?? "",
          cityStatePostal: client.cityStatePostal,
          country: client.country,
          email: client.email,
          attentionTo: client.attentionTo ?? "",
          notes: client.notes ?? "",
        }}
      />
    </div>
  );
}
