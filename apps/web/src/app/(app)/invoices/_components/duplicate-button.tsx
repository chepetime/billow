"use client";

import { Button } from "@billow/shadcn/components/button";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { duplicateInvoice } from "@/lib/actions/invoices";
import { notifyError, notifySuccess } from "@/lib/notify";

/**
 * Copy this invoice into a new draft and open it.
 *
 * The recurring monthly invoice is the case this app exists for, so the copy
 * lands on the edit screen rather than the preview: the user came here to
 * change the dates and send it, not to admire it.
 */
export function DuplicateButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateInvoice(id);

      if (!result.ok) {
        notifyError("Not duplicated", result.error);
        return;
      }

      notifySuccess("Draft created");
      router.push(`/invoices/${result.data.id}/edit`);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={duplicate}
      disabled={pending}
    >
      {pending ? "Duplicating..." : "Duplicate"}
    </Button>
  );
}
