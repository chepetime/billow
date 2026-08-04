"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const RECOVERY_KEY_PATH = "/onboarding/recovery-key";
const RESTORE_PATH = "/onboarding/restore-access";

/**
 * Sends a signed-in user to collect their recovery key until they confirm they
 * have it.
 *
 * This is a client component specifically because a layout cannot see the
 * current path. Redirecting from the layout would fire on every route beneath
 * it — including the onboarding page itself — and loop forever. Knowing the
 * pathname is the whole reason this runs in the browser.
 *
 * The cost is that the page underneath renders for a moment first. That is the
 * right trade here: the gate is about making sure the step happens, not about
 * hiding anything. Nothing behind it is secret from the user being redirected,
 * and a server-side gate that can trap someone in a redirect loop is far worse
 * than a brief flash.
 */
export function OnboardingGate({
  needsRestore,
  needsRecoveryKey,
}: {
  needsRestore: boolean;
  needsRecoveryKey: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Restore comes first: an account that cannot reach its data key has a
    // more urgent problem than one that merely owes us a confirmation, and
    // restoring is what makes the recovery-key step meaningful afterwards.
    const destination = needsRestore
      ? RESTORE_PATH
      : needsRecoveryKey
        ? RECOVERY_KEY_PATH
        : null;

    if (!destination || pathname === destination) return;
    router.replace(destination);
  }, [needsRestore, needsRecoveryKey, pathname, router]);

  return null;
}
