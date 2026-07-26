"use client";

import { toast } from "@billow/shadcn/components/toast";

/**
 * Thin wrappers over the shared toast manager so call sites read as intent
 * rather than configuration, and so success/failure styling stays consistent.
 *
 * The `<Toaster>` in the root layout provides the context these write into.
 */

export function notifySuccess(title: string, description?: string) {
  toast.add({ title, description, type: "success" });
}

export function notifyError(title: string, description?: string) {
  toast.add({ title, description, type: "error" });
}
