import { requireSession } from "@billow/auth";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientForm } from "@/app/(app)/clients/_components/client-form";
import { getClientCompany } from "@/lib/workspace/clients";

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

  // Was: load every client and find this one. The rule looks it up scoped to
  // its owner, which is both the cheaper query and the same one the API uses.
  const result = await getClientCompany(session.user.id, clientId);
  if (!result.ok) notFound();
  const client = result.data;

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
