"use client";

import { useState } from "react";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { ImportSummary } from "@/lib/backup";

function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? null;
}

function summaryDescription(summary: ImportSummary): string {
  const parts = [
    `${summary.userProfiles} profile${summary.userProfiles === 1 ? "" : "s"}`,
    `${summary.bankAccounts} bank account${summary.bankAccounts === 1 ? "" : "s"}`,
    `${summary.clientCompanies} client${summary.clientCompanies === 1 ? "" : "s"}`,
    `${summary.invoices} invoice${summary.invoices === 1 ? "" : "s"}`,
  ];
  const skipped = summary.skippedBankAccounts + summary.skippedInvoices;
  const base = `Added ${parts.join(", ")}.`;
  return skipped > 0
    ? `${base} Skipped ${skipped} row${skipped === 1 ? "" : "s"} with missing references.`
    : base;
}

/**
 * Lets an administrator export their own workspace data to a JSON file, and
 * restore a previously exported file back into the current account.
 */
export function BackupSection() {
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  async function handleExport() {
    setIsExporting(true);
    try {
      const response = await fetch("/api/admin/backup");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        notifyError("Backup failed", body?.error ?? undefined);
        return;
      }

      const blob = await response.blob();
      const filename =
        contentDispositionFilename(
          response.headers.get("content-disposition"),
        ) ?? "billow-backup.json";

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      notifySuccess("Backup downloaded", filename);
    } catch {
      notifyError("Backup failed", "Could not reach the server.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleRestore() {
    if (!selectedFile) {
      notifyError("Choose a file first", "Select a Billow backup JSON file to restore.");
      return;
    }

    setIsRestoring(true);
    try {
      const text = await selectedFile.text();
      const payload = JSON.parse(text);

      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const fieldErrors = body?.fields
          ? Object.values(body.fields as Record<string, string[]>)
              .flat()
              .join(" ")
          : undefined;
        notifyError("Restore failed", body?.error ?? fieldErrors ?? undefined);
        return;
      }

      notifySuccess("Backup restored", summaryDescription(body.summary as ImportSummary));
      setSelectedFile(null);
      setFileInputKey((key) => key + 1);
    } catch {
      notifyError("Restore failed", "The selected file is not valid JSON.");
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Backup</h2>
        <p className="text-sm text-muted-foreground">
          Export your profiles, bank accounts, clients and invoices as a JSON
          file you control. Restoring a file <strong>adds</strong> its rows to
          the current account — it never deletes or overwrites what is already
          here, so restoring the same file twice creates duplicates.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleExport} disabled={isExporting}>
          {isExporting ? "Preparing..." : "Download backup"}
        </Button>
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">Restore from a backup file</p>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            key={fileInputKey}
            type="file"
            accept="application/json"
            className="w-auto"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleRestore}
            disabled={isRestoring || !selectedFile}
          >
            {isRestoring ? "Restoring..." : "Restore"}
          </Button>
        </div>
      </div>
    </section>
  );
}
