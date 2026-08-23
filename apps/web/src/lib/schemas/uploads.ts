import { z } from "zod";

/** Shape returned for a single upload. Also feeds the OpenAPI document. */
export const uploadResponseSchema = z.object({
  id: z.string().meta({ description: "Stable upload identifier." }),
  filename: z.string().meta({
    description: "Display filename supplied by the client, sanitized.",
  }),
  contentType: z.string().meta({
    description:
      "MIME type detected from the file's bytes. Never the client's declared Content-Type.",
  }),
  size: z.number().int().nonnegative().meta({ description: "Size in bytes." }),
  kind: z.string().meta({
    description:
      'Attachment classification. Account files use "attachment"; workflow documents are hidden from the account list.',
  }),
  createdAt: z
    .string()
    .meta({ description: "When the file was uploaded, as an ISO timestamp." }),
});

export const uploadUsageSchema = z.object({
  bytes: z
    .number()
    .int()
    .nonnegative()
    .meta({ description: "Total bytes currently stored for this account." }),
  limitBytes: z
    .number()
    .int()
    .positive()
    .meta({ description: "Per-account storage quota, in bytes." }),
});

export const uploadListResponseSchema = z.object({
  uploads: z.array(uploadResponseSchema),
  usage: uploadUsageSchema,
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type UploadUsage = z.infer<typeof uploadUsageSchema>;
export type UploadListResponse = z.infer<typeof uploadListResponseSchema>;

/**
 * Human-readable byte count for quota messages and the usage bar. Shared by
 * the API (error text) and the settings UI so the two never disagree.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
