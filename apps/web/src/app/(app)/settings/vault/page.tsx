import { VaultSection } from "@/app/(app)/settings/_components/vault-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vault lab" };

export default function VaultPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vault lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Exercise encrypted database storage before applying it to business records.
        </p>
      </div>
      <VaultSection />
    </div>
  );
}
