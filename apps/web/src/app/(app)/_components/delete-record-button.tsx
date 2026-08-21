"use client";

import { Button } from "@billow/shadcn/components/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ActionResult } from "@/lib/actions/result";
import { notifyError, notifySuccess } from "@/lib/notify";

/**
 * Delete, behind a second click.
 *
 * An inline confirm rather than `window.confirm` or a modal: the destructive
 * action and its confirmation occupy the same spot, so nothing moves under the
 * pointer, and there is no dialog to trap focus for a one-word decision.
 */
export function DeleteRecordButton({
  onDelete,
  label,
  redirectTo,
  successMessage,
}: {
  onDelete: () => Promise<ActionResult>;
  label: string;
  redirectTo: string;
  successMessage: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await onDelete();

      if (!result.ok) {
        // Deletion is refused for a reason worth reading in full — a record
        // still attached to an invoice — so it gets a toast, not a flash.
        notifyError("Not deleted", result.error);
        setArmed(false);
        return;
      }

      notifySuccess(successMessage);
      router.push(redirectTo);
      router.refresh();
    });
  }

  if (!armed) {
    return (
      <Button type="button" variant="ghost" onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        onClick={remove}
        disabled={pending}
      >
        {pending ? "Deleting..." : "Confirm delete"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setArmed(false)}
        disabled={pending}
      >
        Cancel
      </Button>
    </div>
  );
}
