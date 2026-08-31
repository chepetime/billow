import { requireSession } from "@billow/auth";
import type { Metadata } from "next";
import { FilesSection } from "@/app/(app)/settings/_components/files-section";
import { listUploads } from "@/lib/uploads";

export const metadata: Metadata = {
  title: "Files",
};

export const dynamic = "force-dynamic";

export default async function FilesSettingsPage() {
  const session = await requireSession();
  const { uploads, usageBytes, limitBytes } = await listUploads(
    session.user.id,
  );

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-normal">Files</h1>
        <p className="text-sm text-muted-foreground">
          Avatars, images and PDFs attached to your account.
        </p>
      </div>

      <FilesSection
        initialUploads={uploads.map((upload) => ({
          id: upload.id,
          filename: upload.filename,
          contentType: upload.contentType,
          size: upload.size,
          createdAt: upload.createdAt.toISOString(),
        }))}
        initialUsageBytes={usageBytes}
        limitBytes={limitBytes}
      />
    </div>
  );
}
