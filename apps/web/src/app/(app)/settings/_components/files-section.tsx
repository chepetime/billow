"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload } from "lucide-react";

import { Badge } from "@billow/shadcn/components/badge";
import { Button, buttonVariants } from "@billow/shadcn/components/button";
import { Progress } from "@billow/shadcn/components/progress";
import { formatBytes } from "@/lib/schemas/uploads";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";

export type FileSummary = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error;
}

/**
 * Lets an account upload avatars, images and PDFs, browse what's already
 * stored, and download or delete individual files. Mutates through the
 * /api/v1/uploads API (there's no authClient plugin for this, unlike
 * sessions/keys), so state here is optimistic-on-success rather than
 * driven by a client library.
 */
export function FilesSection({
  initialUploads,
  initialUsageBytes,
  limitBytes,
}: {
  initialUploads: FileSummary[];
  initialUsageBytes: number;
  limitBytes: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState(initialUploads);
  const [usageBytes, setUsageBytes] = useState(initialUsageBytes);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const usagePercent = Math.min(100, Math.round((usageBytes / limitBytes) * 100));

  async function uploadFile(file: File) {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/v1/uploads", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        notifyError("Upload failed", await readErrorMessage(response));
        return;
      }

      const created = (await response.json()) as FileSummary;
      setUploads((current) => [created, ...current]);
      setUsageBytes((current) => current + created.size);
      notifySuccess("File uploaded", created.filename);
      router.refresh();
    } catch {
      notifyError("Upload failed", "Could not reach the server.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    void uploadFile(file);
  }

  async function handleDelete(id: string) {
    setPendingDeleteId(id);
    try {
      const response = await fetch(`/api/v1/uploads/${id}`, { method: "DELETE" });
      if (!response.ok) {
        notifyError("Delete failed", await readErrorMessage(response));
        return;
      }

      const removed = uploads.find((upload) => upload.id === id);
      setUploads((current) => current.filter((upload) => upload.id !== id));
      if (removed) {
        setUsageBytes((current) => Math.max(0, current - removed.size));
      }
      notifySuccess("File deleted");
      router.refresh();
    } catch {
      notifyError("Delete failed", "Could not reach the server.");
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Files</h2>
        <p className="text-sm text-muted-foreground">
          Attach avatars, images and PDFs to your account. Accepted types: PNG, JPEG, GIF, WEBP,
          PDF.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Storage used</span>
          <span className="text-muted-foreground">
            {formatBytes(usageBytes)} of {formatBytes(limitBytes)}
          </span>
        </div>
        <Progress value={usagePercent} />
      </div>

      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors",
          isDragging ? "border-primary bg-muted/50" : "border-border",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <CloudUpload aria-hidden="true" className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Drag a file here, or</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? "Uploading..." : "Choose a file"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {uploads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {uploads.map((upload) => (
            <li
              key={upload.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">{upload.filename}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{upload.contentType}</Badge>
                  <span>{formatBytes(upload.size)}</span>
                  <span>· {formatDate(upload.createdAt)}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/v1/uploads/${upload.id}`}
                  download={upload.filename}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Download
                </a>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pendingDeleteId === upload.id}
                  onClick={() => handleDelete(upload.id)}
                >
                  {pendingDeleteId === upload.id ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
