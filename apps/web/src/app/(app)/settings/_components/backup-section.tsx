"use client";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { useState } from "react";
import type { ImportSummary } from "@/lib/backup";
import { notifyError, notifySuccess } from "@/lib/notify";

function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? null;
}

type UploadRestoreResult = {
  uploads: number;
  skippedUploads: number;
  reasons: string[];
};

/**
 * Files are reported separately from rows, and a skip is always stated.
 *
 * A restore that silently returned fewer files than the backup held is the
 * exact failure this feature exists to remove, so "0 files" and "3 of 5 files"
 * both have to be visible rather than implied.
 */
function uploadsDescription(result: UploadRestoreResult | undefined): string {
  if (!result) return "";

  const restored = `Restored ${result.uploads} file${result.uploads === 1 ? "" : "s"}.`;
  return result.skippedUploads > 0
    ? `${restored} Skipped ${result.skippedUploads}: ${result.reasons.slice(1).join("; ")}`
    : restored;
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
      notifyError(
        "Choose a file first",
        "Select a Billow backup file to restore.",
      );
      return;
    }

    setIsRestoring(true);
    try {
      // Sent as raw bytes rather than parsed here: a backup is now a gzipped
      // archive, and the server has to detect the format anyway to keep
      // accepting the older JSON-only exports.
      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: selectedFile,
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

      notifySuccess(
        "Backup restored",
        [
          summaryDescription(body.summary as ImportSummary),
          uploadsDescription(body.uploads as UploadRestoreResult | undefined),
        ]
          .filter(Boolean)
          .join(" "),
      );
      setSelectedFile(null);
      setFileInputKey((key) => key + 1);
    } catch {
      notifyError("Restore failed", "The selected file could not be read.");
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Backup</h2>
        <p className="text-sm text-muted-foreground">
          Export your profiles, bank accounts, clients and invoices, together
          with your uploaded files, as a single archive you control. Restoring
          <strong> adds</strong> to the current account — it never deletes or
          overwrites what is already here, so restoring the same file twice
          creates duplicates.
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
            accept=".tar.gz,.gz,application/gzip,application/json"
            className="w-auto"
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] ?? null)
            }
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
