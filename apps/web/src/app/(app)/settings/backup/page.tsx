import { requireAdmin } from "@billow/auth";
import { BackupSection } from "@/app/(app)/settings/_components/backup-section";

export const dynamic = "force-dynamic";

export const metadata = { title: "Backup" };

export default async function BackupPage() {
  await requireAdmin();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Backup</h1>
        <p className="text-sm text-muted-foreground">
          Export and restore your data. Only administrators can see this page.
        </p>
      </div>

      <BackupSection />

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Invoices as CSV</h2>
          <p className="text-sm text-muted-foreground">
            One row per invoice — invoice number, date, client, currency,
            status, and total — for a spreadsheet or accounting tool. This is
            not a backup: it cannot be restored, and it does not include bank or
            profile details.
          </p>
        </div>

        <a
          href="/api/admin/invoices/export"
          className="text-sm text-primary underline underline-offset-4"
        >
          Download invoices.csv
        </a>
      </section>
    </div>
  );
}
