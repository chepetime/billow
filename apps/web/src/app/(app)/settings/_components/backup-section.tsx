"use client";

import { Button } from "@billow/shadcn/components/button";
import { Checkbox } from "@billow/shadcn/components/checkbox";
import { Input } from "@billow/shadcn/components/input";
import { Label } from "@billow/shadcn/components/label";
import { useState } from "react";
import { Field } from "@/components/ui/field";
import type { ImportSummary } from "@/lib/backup";
import { RECOVERY_KEY_HEADER } from "@/lib/backup-format";
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
 * Lets an administrator export their own workspace data as an archive, and
 * restore a previously exported file back into the current account.
 *
 * The export is decrypted by default, which the copy below states rather than
 * leaves to be discovered: the archive holds real account numbers and tax IDs
 * in a file that ends up in a Downloads folder. Sealing it under the recovery
 * key is offered right there, at the moment the tradeoff is being made.
 */
export function BackupSection() {
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [encryptExport, setEncryptExport] = useState(false);
  const [exportKey, setExportKey] = useState("");
  const [restoreKey, setRestoreKey] = useState("");

  async function handleExport() {
    if (encryptExport && !exportKey.trim()) {
      notifyError(
        "Enter your recovery key",
        "An encrypted backup is sealed with it, and only it can open the file again.",
      );
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch("/api/admin/backup", {
        headers: encryptExport
          ? { [RECOVERY_KEY_HEADER]: exportKey.trim() }
          : undefined,
      });
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

      notifySuccess(
        "Backup downloaded",
        encryptExport
          ? `${filename} — it can only be restored with the recovery key it was sealed with.`
          : `${filename} — this file is not encrypted. Store it somewhere you would keep a bank statement.`,
      );
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
        headers: {
          "Content-Type": "application/octet-stream",
          // Sent whenever one has been typed; the server only asks for it when
          // the archive actually carries an envelope, so there is nothing here
          // to decide about a file this page has not opened.
          ...(restoreKey.trim()
            ? { [RECOVERY_KEY_HEADER]: restoreKey.trim() }
            : {}),
        },
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
      setRestoreKey("");
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

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-muted-foreground">
        A backup is written <strong>decrypted</strong> unless you encrypt it
        below — account numbers, IBANs and tax IDs are stored encrypted in the
        database but appear in the file as plain text, because a backup only
        this installation can read is not a backup. Treat the download the way
        you would treat a bank statement.
      </p>

      <div className="space-y-3">
        <Label className="items-start gap-3" htmlFor="backup-encrypt">
          <Checkbox
            id="backup-encrypt"
            checked={encryptExport}
            onCheckedChange={(checked) => setEncryptExport(checked === true)}
          />
          <span className="space-y-1">
            <span className="block">Encrypt with my recovery key</span>
            <span className="block text-sm font-normal text-muted-foreground">
              The file can then only be restored with that key. Lose the key and
              the backup is unreadable — there is no other way in, by design.
            </span>
          </span>
        </Label>

        {encryptExport ? (
          <Field
            label="Recovery key"
            htmlFor="backup-export-key"
            hint="The key you saved during onboarding. It is checked before anything is exported, so a typo cannot produce a backup you can never open."
          >
            <Input
              id="backup-export-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              value={exportKey}
              onChange={(event) => setExportKey(event.target.value)}
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleExport} disabled={isExporting}>
            {isExporting ? "Preparing..." : "Download backup"}
          </Button>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
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

        <Field
          label="Recovery key"
          htmlFor="backup-restore-key"
          hint="Only needed for an encrypted backup, and it is the key that file was sealed with — not necessarily this account's current one."
        >
          <Input
            id="backup-restore-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Leave empty for an unencrypted backup"
            value={restoreKey}
            onChange={(event) => setRestoreKey(event.target.value)}
          />
        </Field>
      </div>
    </section>
  );
}
